import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_AGE_SECONDS,
  DEFAULT_MAX_HEALTH_RESPONSE_BYTES,
  DEFAULT_MAX_HEALTH_RESPONSE_HEADER_BYTES,
  formatFreshnessStepSummary,
  PANDA_GAMES,
  sanitizeFreshnessMessage,
  validateNoStoreHealthResponse,
  validateScheduleFreshness,
} from "./validate-schedule-freshness.mjs";

const now = Date.parse("2026-10-22T12:00:00.000Z");
const freshTime = new Date(now - 5 * 60_000).toISOString();

function health(overrides = {}) {
  return {
    mode: "live",
    demoMode: false,
    stale: false,
    sourceFetchedAt: freshTime,
    lastSuccessfulSyncAt: freshTime,
    games: Object.fromEntries(PANDA_GAMES.map((game) => [game, {
      syncStatus: "normal",
      sourceFetchedAt: freshTime,
      lastSuccessfulSyncAt: freshTime,
    }])),
    ...overrides,
  };
}

function headers(status = 200, cacheControl = "no-store, no-cache, must-revalidate") {
  return `HTTP/2 ${status}\r\ncache-control: ${cacheControl}\r\n\r\n`;
}

describe("schedule freshness monitor validation", () => {
  it("requires a matching final response status and an explicit no-store policy", () => {
    expect(validateNoStoreHealthResponse(headers(), 200)).toEqual({
      ok: true,
      message: "health response is explicitly no-store",
    });
    expect(validateNoStoreHealthResponse("", 200).ok).toBe(false);
    expect(validateNoStoreHealthResponse(headers(200, "no-cache"), 200).message)
      .toBe("health response is missing Cache-Control: no-store");
    expect(validateNoStoreHealthResponse(headers(200, "no-store, public, max-age=60"), 200).message)
      .toBe("health response has a contradictory cache policy");
    expect(validateNoStoreHealthResponse(headers(200), 503).message)
      .toBe("health response headers do not match the final HTTP status");
  });

  it("uses the last HTTP header block after interim or retried responses", () => {
    const responseHeaders = [
      "HTTP/1.1 100 Continue\r\n\r\n",
      "HTTP/2 503\r\ncache-control: public, max-age=30\r\n\r\n",
      "HTTP/2 200\r\ncache-control: no-store, no-cache\r\n\r\n",
    ].join("");
    expect(validateNoStoreHealthResponse(responseHeaders, 200).ok).toBe(true);
  });

  it("accepts a live, non-stale schedule with fresh snapshots for all five games", () => {
    expect(validateScheduleFreshness(health(), 200, now)).toEqual({
      ok: true,
      message: `fresh: all 5 games are within ${DEFAULT_MAX_AGE_SECONDS}s`,
    });
  });

  it("rejects non-success HTTP responses without trusting their body", () => {
    expect(validateScheduleFreshness(health(), 503, now).message).toBe("health endpoint returned HTTP 503");
  });

  it("rejects unavailable, demo, or stale aggregate data", () => {
    expect(validateScheduleFreshness(health({ mode: "unavailable" }), 200, now).ok).toBe(false);
    expect(validateScheduleFreshness(health({ demoMode: true }), 200, now).ok).toBe(false);
    expect(validateScheduleFreshness(health({ stale: true }), 200, now).message)
      .toBe("health response reports stale schedule data");
  });

  it("rejects an old aggregate source timestamp even if lastAttemptAt could be recent", () => {
    const oldTime = new Date(now - 16 * 60_000).toISOString();
    expect(validateScheduleFreshness(health({
      sourceFetchedAt: oldTime,
      lastAttemptAt: new Date(now - 30_000).toISOString(),
    }), 200, now).message)
      .toContain("sourceFetchedAt is 960s old");
  });

  it("rejects source timestamps implausibly far in the future", () => {
    const futureTime = new Date(now + 61_000).toISOString();
    expect(validateScheduleFreshness(health({ sourceFetchedAt: futureTime }), 200, now).message)
      .toBe("sourceFetchedAt is more than 60s in the future");
  });

  it.each([
    "2026-02-30T11:55:00.000Z",
    "2026-10-22T11:55:00.000",
    "2026-10-22T11:55:00.000+14:30",
  ])("rejects malformed or ambiguous ISO timestamps: %s", (timestamp) => {
    expect(validateScheduleFreshness(health({ sourceFetchedAt: timestamp }), 200, now))
      .toMatchObject({ ok: false, message: "sourceFetchedAt is missing or invalid" });
  });

  it("rejects a timestamp even one millisecond beyond the freshness limit", () => {
    const justExpired = new Date(now - DEFAULT_MAX_AGE_SECONDS * 1_000 - 1).toISOString();
    expect(validateScheduleFreshness(health({ sourceFetchedAt: justExpired }), 200, now).ok).toBe(false);
  });

  it("accepts a timestamp exactly at the freshness limit", () => {
    const boundary = new Date(now - DEFAULT_MAX_AGE_SECONDS * 1_000).toISOString();
    expect(validateScheduleFreshness(health({ sourceFetchedAt: boundary }), 200, now).ok).toBe(true);
  });

  it("checks each game's source and success timestamps rather than the aggregate maximum", () => {
    const games = health().games;
    const oldTime = new Date(now - 16 * 60_000).toISOString();
    games.valorant = { ...games.valorant, lastSuccessfulSyncAt: oldTime };
    expect(validateScheduleFreshness(health({ games }), 200, now).message)
      .toContain("valorant lastSuccessfulSyncAt is 960s old");
  });

  it("rejects a per-game success timestamp that predates its source snapshot", () => {
    const games = health().games;
    games.cs2 = {
      ...games.cs2,
      sourceFetchedAt: new Date(now - 2 * 60_000).toISOString(),
      lastSuccessfulSyncAt: new Date(now - 3 * 60_000).toISOString(),
    };

    expect(validateScheduleFreshness(health({ games }), 200, now)).toEqual({
      ok: false,
      message: "cs2 lastSuccessfulSyncAt is earlier than sourceFetchedAt",
    });
  });

  it("rejects aggregate success metadata that predates the aggregate source snapshot", () => {
    expect(validateScheduleFreshness(health({
      sourceFetchedAt: new Date(now - 2 * 60_000).toISOString(),
      lastSuccessfulSyncAt: new Date(now - 3 * 60_000).toISOString(),
    }), 200, now)).toEqual({
      ok: false,
      message: "lastSuccessfulSyncAt is earlier than sourceFetchedAt",
    });
  });

  it("rejects per-game failed or delayed sync status", () => {
    const games = health().games;
    games.cs2 = { ...games.cs2, syncStatus: "failed" };
    expect(validateScheduleFreshness(health({ games }), 200, now).message)
      .toBe("cs2 sync status is failed");
    games.cs2 = { ...games.cs2, syncStatus: "delayed" };
    expect(validateScheduleFreshness(health({ games }), 200, now).message)
      .toBe("cs2 sync status is delayed");
  });

  it("rejects missing game coverage and invalid timestamps", () => {
    const games = health().games;
    delete games.dota2;
    expect(validateScheduleFreshness(health({ games }), 200, now).message)
      .toBe("health response is missing dota2 coverage");
    expect(validateScheduleFreshness(health({ lastSuccessfulSyncAt: null }), 200, now).message)
      .toBe("lastSuccessfulSyncAt is missing or invalid");
  });

  it("formats a concise PASS summary for a fresh schedule", () => {
    expect(formatFreshnessStepSummary({ ok: true, message: "fresh: all 5 games are within 900s" }))
      .toBe("### Schedule freshness: PASS\n\nfresh: all 5 games are within 900s\n");
  });

  it("formats failures as one Markdown-safe line without allowing upstream text to inject headings", () => {
    const summary = formatFreshnessStepSummary({
      ok: false,
      message: "lol sync status is bad [details]\n## forged heading",
    });
    expect(summary).toBe("### Schedule freshness: FAIL\n\nlol sync status is bad \\[details\\] \\#\\# forged heading\n");
  });

  it("sanitizes log messages into one bounded line", () => {
    expect(sanitizeFreshnessMessage("failed\r\n## forged log"))
      .toBe("failed ## forged log");
    const terminalControls = sanitizeFreshnessMessage("bad\u001b[2J\u009b31m\u2028forged\u0000log");
    expect(terminalControls).toBe("bad [2J 31m forged log");
    expect(terminalControls).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(sanitizeFreshnessMessage("x".repeat(301))).toHaveLength(300);
  });

  it("writes a PASS summary from the CLI and exits successfully for fresh data", () => {
    const directory = mkdtempSync(join(tmpdir(), "schedule-freshness-pass-"));
    try {
      const responsePath = join(directory, "health.json");
      const headersPath = join(directory, "headers.txt");
      const summaryPath = join(directory, "summary.md");
      const currentTime = new Date().toISOString();
      const currentHealth = health({
        sourceFetchedAt: currentTime,
        lastSuccessfulSyncAt: currentTime,
        games: Object.fromEntries(PANDA_GAMES.map((game) => [game, {
          syncStatus: "normal",
          sourceFetchedAt: currentTime,
          lastSuccessfulSyncAt: currentTime,
        }])),
      });
      writeFileSync(responsePath, JSON.stringify(currentHealth));
      writeFileSync(headersPath, headers());
      const result = spawnSync(
        process.execPath,
        [resolve(process.cwd(), "scripts/validate-schedule-freshness.mjs"), responsePath, "200", headersPath],
        { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath } },
      );

      expect(result.status).toBe(0);
      expect(readFileSync(summaryPath, "utf8")).toContain("### Schedule freshness: PASS");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes a FAIL summary and preserves the non-zero CLI exit for malformed JSON", () => {
    const directory = mkdtempSync(join(tmpdir(), "schedule-freshness-fail-"));
    try {
      const responsePath = join(directory, "health.json");
      const headersPath = join(directory, "headers.txt");
      const summaryPath = join(directory, "summary.md");
      writeFileSync(responsePath, "{malformed");
      writeFileSync(headersPath, headers());
      const result = spawnSync(
        process.execPath,
        [resolve(process.cwd(), "scripts/validate-schedule-freshness.mjs"), responsePath, "200", headersPath],
        { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath } },
      );

      expect(result.status).toBe(1);
      expect(readFileSync(summaryPath, "utf8"))
        .toContain("### Schedule freshness: FAIL\n\nhealth endpoint returned unreadable JSON");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an oversized health response without printing its contents", () => {
    const directory = mkdtempSync(join(tmpdir(), "schedule-freshness-oversize-"));
    try {
      const responsePath = join(directory, "health.json");
      const headersPath = join(directory, "headers.txt");
      const summaryPath = join(directory, "summary.md");
      const marker = "private-response-marker";
      writeFileSync(responsePath, `${marker}${"x".repeat(DEFAULT_MAX_HEALTH_RESPONSE_BYTES)}`);
      writeFileSync(headersPath, headers());
      const result = spawnSync(
        process.execPath,
        [resolve(process.cwd(), "scripts/validate-schedule-freshness.mjs"), responsePath, "200", headersPath],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_STEP_SUMMARY: summaryPath,
            MAX_HEALTH_RESPONSE_BYTES: "32",
          },
        },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("response exceeds 32 bytes");
      expect(result.stdout).not.toContain(marker);
      expect(readFileSync(summaryPath, "utf8")).toContain("### Schedule freshness: FAIL");
      expect(readFileSync(summaryPath, "utf8")).not.toContain(marker);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed for missing or oversized response headers without logging their content", () => {
    const directory = mkdtempSync(join(tmpdir(), "schedule-freshness-headers-"));
    try {
      const responsePath = join(directory, "health.json");
      const headersPath = join(directory, "headers.txt");
      writeFileSync(responsePath, JSON.stringify(health()));

      const missingHeaders = spawnSync(
        process.execPath,
        [resolve(process.cwd(), "scripts/validate-schedule-freshness.mjs"), responsePath, "200", headersPath],
        { encoding: "utf8" },
      );
      expect(missingHeaders.status).toBe(1);
      expect(missingHeaders.stdout).toContain("response headers are missing or unreadable");

      const marker = "private-header-marker";
      writeFileSync(headersPath, `${headers()}${marker.repeat(DEFAULT_MAX_HEALTH_RESPONSE_HEADER_BYTES)}`);
      const oversizedHeaders = spawnSync(
        process.execPath,
        [resolve(process.cwd(), "scripts/validate-schedule-freshness.mjs"), responsePath, "200", headersPath],
        {
          encoding: "utf8",
          env: { ...process.env, MAX_HEALTH_RESPONSE_HEADER_BYTES: "64" },
        },
      );
      expect(oversizedHeaders.status).toBe(1);
      expect(oversizedHeaders.stdout).toContain("response headers exceed 64 bytes");
      expect(oversizedHeaders.stdout).not.toContain(marker);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("pins the monitor checkout action immutably and disables persisted credentials", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/monitor-schedule-freshness.yml"),
      "utf8",
    );
    const references = workflow
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("uses:"))
      .map((line) => line.slice("uses:".length).trim().split(" #", 1)[0]);

    expect(references).toEqual([
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    ]);
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain('MAX_HEALTH_RESPONSE_BYTES: "262144"');
    expect(workflow).toContain('MAX_HEALTH_RESPONSE_HEADER_BYTES: "16384"');
    expect(workflow).toContain('--max-filesize "$MAX_HEALTH_RESPONSE_BYTES"');
    expect(workflow).toContain('--dump-header "$headers_file"');
    expect(workflow).toContain('node scripts/validate-schedule-freshness.mjs "$response_file" "$http_status" "$headers_file"');
    expect(workflow).toContain('workflows: ["Sync esports fixtures"]');
    expect(workflow).toContain("types: [completed]");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(workflow).toContain("github.event.workflow_run.head_repository.full_name == github.repository");
    expect(workflow).toMatch(/permissions:\r?\n  contents: read/);
    expect(workflow).not.toContain("secrets.");
  });
});
