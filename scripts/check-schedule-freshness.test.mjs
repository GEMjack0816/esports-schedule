import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkScheduleHealth,
  formatFreshnessSummary,
  inspectScheduleFreshness,
  summarizeScheduleHealth,
  writeFreshnessSummary,
} from "./check-schedule-freshness.mjs";

const now = new Date("2026-10-16T12:15:00.000Z");
const gameKeys = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"];

function healthyPayload() {
  const fresh = "2026-10-16T12:10:00.000Z";
  return {
    mode: "live",
    demoMode: false,
    stale: false,
    snapshotAgeSeconds: 300,
    sourceFetchedAt: fresh,
    lastSuccessfulSyncAt: fresh,
    games: Object.fromEntries(gameKeys.map((game) => [game, {
      syncStatus: "normal",
      snapshotAgeSeconds: 300,
      sourceFetchedAt: fresh,
      lastSuccessfulSyncAt: fresh,
    }])),
  };
}

describe("schedule freshness monitor", () => {
  it("accepts live, non-demo data with all five games inside the freshness window", () => {
    expect(inspectScheduleFreshness(healthyPayload(), now)).toEqual({ ok: true, problems: [] });
  });

  it("creates an actionable per-game summary with normalized timestamps", () => {
    const payload = healthyPayload();
    payload.games.cs2.syncStatus = "failed";
    payload.games.cs2.snapshotAgeSeconds = 1_201;
    payload.games.cs2.sourceFetchedAt = "2026-10-16T07:04:59.000-05:00";
    const summary = summarizeScheduleHealth(payload, now);
    const markdown = formatFreshnessSummary(inspectScheduleFreshness(payload, now), summary);

    expect(summary.games).toHaveLength(5);
    expect(summary.games.find((game) => game.game === "cs2")).toEqual({
      game: "cs2",
      syncStatus: "failed",
      snapshotAgeSeconds: 1_201,
      sourceFetchedAt: "2026-10-16T12:04:59.000Z",
      lastSuccessfulSyncAt: "2026-10-16T12:10:00.000Z",
    });
    expect(markdown).toContain("**Result:** FAIL");
    expect(markdown).toContain("| cs2 | failed | 1201 | 2026-10-16T12:04:59.000Z |");
    expect(markdown).toContain("Last successful sync (UTC)");
  });

  it("allowlists summary fields so unexpected health data cannot inject Markdown or secrets", () => {
    const payload = healthyPayload();
    payload.games.lol.syncStatus = "token=private-value";
    payload.games.lol.sourceFetchedAt = "client_secret=private-value";
    payload.database = { targetFingerprint: "private-fingerprint" };
    const markdown = formatFreshnessSummary(
      inspectScheduleFreshness(payload, now),
      summarizeScheduleHealth(payload, now),
    );

    expect(markdown).toContain("| lol | unknown | 300 |");
    expect(markdown).not.toContain("private-value");
    expect(markdown).not.toContain("private-fingerprint");
    expect(markdown).not.toContain("client_secret");
  });

  it("appends the report to the GitHub Actions step-summary file when provided", async () => {
    const directory = mkdtempSync(join(tmpdir(), "schedule-freshness-summary-"));
    const summaryPath = join(directory, "step-summary.md");
    const report = formatFreshnessSummary({ ok: false, problems: ["schedule is marked stale"] });
    try {
      await expect(writeFreshnessSummary(report, summaryPath)).resolves.toBe(true);
      expect(readFileSync(summaryPath, "utf8")).toBe(report);
      await expect(writeFreshnessSummary("\nSecond report\n", summaryPath)).resolves.toBe(true);
      expect(readFileSync(summaryPath, "utf8")).toBe(`${report}\nSecond report\n`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails when the last successful snapshot is stale even if other fields look fresh", () => {
    const payload = healthyPayload();
    payload.sourceFetchedAt = "2026-10-16T11:59:59.000Z";
    payload.snapshotAgeSeconds = 901;
    expect(inspectScheduleFreshness(payload, now).problems).toContain("snapshotAgeSeconds exceeds 900");
    expect(inspectScheduleFreshness(payload, now).problems).toContain("sourceFetchedAt is older than 900 seconds");
  });

  it("accepts exactly 15 minutes but rejects any amount beyond the threshold", () => {
    const exactBoundary = healthyPayload();
    const boundaryTimestamp = "2026-10-16T12:00:00.000Z";
    exactBoundary.sourceFetchedAt = boundaryTimestamp;
    exactBoundary.lastSuccessfulSyncAt = boundaryTimestamp;
    exactBoundary.snapshotAgeSeconds = 900;
    for (const coverage of Object.values(exactBoundary.games)) {
      coverage.sourceFetchedAt = boundaryTimestamp;
      coverage.lastSuccessfulSyncAt = boundaryTimestamp;
      coverage.snapshotAgeSeconds = 900;
    }
    expect(inspectScheduleFreshness(exactBoundary, now)).toEqual({ ok: true, problems: [] });

    exactBoundary.sourceFetchedAt = "2026-10-16T11:59:59.999Z";
    expect(inspectScheduleFreshness(exactBoundary, now).problems).toContain(
      "sourceFetchedAt is older than 900 seconds",
    );
  });

  it("fails closed on unavailable/demo/stale schedule states", () => {
    const payload = { ...healthyPayload(), mode: "unavailable", demoMode: true, stale: true };
    const result = inspectScheduleFreshness(payload, now);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      "schedule mode is not live",
      "demo mode must be false",
      "schedule is marked stale",
    ]));
  });

  it("detects one stale or failed game even when aggregate timestamps are recent", () => {
    const payload = healthyPayload();
    payload.games.cs2.syncStatus = "failed";
    payload.games.cs2.snapshotAgeSeconds = 3_601;
    const result = inspectScheduleFreshness(payload, now);
    expect(result.problems).toContain("cs2 sync status is not normal");
    expect(result.problems).toContain("cs2 snapshot is older than 900 seconds");
  });

  it("rejects missing games and malformed timestamps instead of assuming freshness", () => {
    const payload = healthyPayload();
    delete payload.games.dota2;
    payload.lastSuccessfulSyncAt = "not-a-date";
    const result = inspectScheduleFreshness(payload, now);
    expect(result.problems).toContain("dota2 coverage is missing");
    expect(result.problems).toContain("lastSuccessfulSyncAt timestamp is missing, invalid, or too far in the future");
  });

  it("rejects timestamps implausibly ahead of the monitor clock", () => {
    const payload = healthyPayload();
    payload.games.lol.sourceFetchedAt = "2026-10-16T12:18:00.000Z";
    expect(inspectScheduleFreshness(payload, now).problems).toContain(
      "lol sourceFetchedAt timestamp is missing, invalid, or too far in the future",
    );
  });

  it("accepts only an HTTP 200 JSON health response", async () => {
    const response = new Response(JSON.stringify(healthyPayload()), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    });
    await expect(checkScheduleHealth(async () => response, now)).resolves.toEqual({ ok: true, problems: [] });
    const unavailable = await checkScheduleHealth(
      async () => new Response("unavailable", { status: 503 }),
      now,
      async () => {},
    );
    expect(unavailable.problems).toEqual(["health endpoint returned HTTP 503"]);
  });

  it("retries a transient network failure once before accepting a healthy response", async () => {
    let attempts = 0;
    const delays = [];
    const result = await checkScheduleHealth(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("sensitive transport details");
      return new Response(JSON.stringify(healthyPayload()), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    }, now, async (milliseconds) => delays.push(milliseconds));

    expect(result).toEqual({ ok: true, problems: [] });
    expect(attempts).toBe(2);
    expect(delays).toEqual([500]);
  });

  it("retries bounded 5xx responses with backoff and succeeds when the endpoint recovers", async () => {
    let attempts = 0;
    const delays = [];
    const result = await checkScheduleHealth(async () => {
      attempts += 1;
      if (attempts < 3) return new Response("temporary server error", { status: 503 });
      return new Response(JSON.stringify(healthyPayload()), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    }, now, async (milliseconds) => delays.push(milliseconds));

    expect(result).toEqual({ ok: true, problems: [] });
    expect(attempts).toBe(3);
    expect(delays).toEqual([500, 1_000]);
  });

  it("stops after the bounded network retry budget and hides transport details", async () => {
    let attempts = 0;
    const delays = [];
    const result = await checkScheduleHealth(async () => {
      attempts += 1;
      throw new Error("private host and transport details");
    }, now, async (milliseconds) => delays.push(milliseconds));

    expect(result).toEqual({
      ok: false,
      problems: ["health endpoint request failed or timed out"],
    });
    expect(attempts).toBe(3);
    expect(delays).toEqual([500, 1_000]);
    expect(JSON.stringify(result)).not.toContain("private host");
  });

  it("does not retry client or protocol failures", async () => {
    let attempts = 0;
    const result = await checkScheduleHealth(async () => {
      attempts += 1;
      return new Response("forbidden", { status: 403 });
    }, now, async () => {});

    expect(result.problems).toEqual(["health endpoint returned HTTP 403"]);
    expect(attempts).toBe(1);
  });

  it("uses only a no-store, unauthenticated GET to the public health endpoint", async () => {
    let requestedUrl;
    let requestOptions;
    const response = new Response(JSON.stringify(healthyPayload()), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
    await checkScheduleHealth(async (url, options) => {
      requestedUrl = url;
      requestOptions = options;
      return response;
    }, now);

    expect(requestedUrl).toBe("https://esports-schedule-two.vercel.app/api/health/data-coverage");
    expect(requestOptions.method).toBeUndefined();
    expect(requestOptions.cache).toBe("no-store");
    expect(requestOptions.redirect).toBe("error");
    expect(requestOptions.headers).toEqual({ accept: "application/json" });
    expect(requestOptions.headers.authorization).toBeUndefined();
  });

  it("keeps the scheduled monitor main-only and separate from sync triggers", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/check-schedule-freshness.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toMatch(/cron: "12,27,42,57 \* \* \* \*"/);
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
    const triggerBlock = workflow.match(
      /^on:\r?\n((?:[ \t]+[^\r\n]*\r?\n|[ \t]*\r?\n)*)/m,
    )?.[1];
    const triggers = [...(triggerBlock ?? "").matchAll(/^  ([A-Za-z_][A-Za-z0-9_-]*):/gm)]
      .map((match) => match[1]);
    expect(triggers).toEqual(["schedule", "workflow_dispatch"]);

    const permissionBlock = workflow.match(
      /^permissions:\r?\n((?:[ \t]+[^\r\n]*\r?\n|[ \t]*\r?\n)*)/m,
    )?.[1];
    const permissions = [...(permissionBlock ?? "").matchAll(/^  ([A-Za-z_][A-Za-z0-9_-]*):\s*(\S+)/gm)]
      .map((match) => [match[1], match[2]]);
    expect(permissions).toEqual([["contents", "read"]]);
    expect(workflow).not.toMatch(/^\s*(?:push|pull_request):/m);
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("/api/cron/sync");
    expect(workflow).toContain(
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    expect(workflow).toContain(
      "uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
    );
  });

  it("fails closed on non-JSON and oversized health responses", async () => {
    const html = await checkScheduleHealth(async () => new Response("<html>protected</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }), now);
    expect(html.problems).toEqual(["health endpoint did not return application/json"]);

    const large = await checkScheduleHealth(async () => new Response("x".repeat(128 * 1024 + 1), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }), now);
    expect(large.problems).toEqual(["health response was unreadable or exceeded the size limit"]);
  });

  it("rejects cacheable health responses to avoid passing on stale CDN data", async () => {
    for (const cacheControl of [
      "",
      "public, max-age=60",
      "public, s-maxage=900",
      "no-store=false",
      "private, no-store=0",
    ]) {
      const response = await checkScheduleHealth(async () => new Response(JSON.stringify(healthyPayload()), {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(cacheControl ? { "cache-control": cacheControl } : {}),
        },
      }), now);
      expect(response).toEqual({
        ok: false,
        problems: ["health endpoint response is missing the no-store cache directive"],
      });
    }
  });

  it("accepts the exact no-store directive with surrounding whitespace and case differences", async () => {
    const response = await checkScheduleHealth(async () => new Response(JSON.stringify(healthyPayload()), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "private,  No-Store , max-age=0",
      },
    }), now);
    expect(response).toEqual({ ok: true, problems: [] });
  });

  it("does not echo low-level network exceptions", async () => {
    const result = await checkScheduleHealth(async () => {
      throw new Error("private credential should not be echoed");
    }, now);
    expect(result.problems).toEqual(["health endpoint request failed or timed out"]);
    expect(JSON.stringify(result)).not.toContain("private credential");
  });
});


