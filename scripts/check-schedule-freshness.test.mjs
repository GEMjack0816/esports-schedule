import { describe, expect, it } from "vitest";
import { checkScheduleHealth, inspectScheduleFreshness } from "./check-schedule-freshness.mjs";

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

  it("fails when the last successful snapshot is stale even if other fields look fresh", () => {
    const payload = healthyPayload();
    payload.sourceFetchedAt = "2026-10-16T11:59:59.000Z";
    payload.snapshotAgeSeconds = 901;
    expect(inspectScheduleFreshness(payload, now).problems).toContain("snapshotAgeSeconds exceeds 900");
    expect(inspectScheduleFreshness(payload, now).problems).toContain("sourceFetchedAt is older than 900 seconds");
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
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    await expect(checkScheduleHealth(async () => response, now)).resolves.toEqual({ ok: true, problems: [] });
    const unavailable = await checkScheduleHealth(async () => new Response("unavailable", { status: 503 }), now);
    expect(unavailable.problems).toEqual(["health endpoint returned HTTP 503"]);
  });

  it("fails closed on non-JSON and oversized health responses", async () => {
    const html = await checkScheduleHealth(async () => new Response("<html>protected</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }), now);
    expect(html.problems).toEqual(["health endpoint did not return application/json"]);

    const large = await checkScheduleHealth(async () => new Response("x".repeat(128 * 1024 + 1), {
      status: 200,
      headers: { "content-type": "application/json" },
    }), now);
    expect(large.problems).toEqual(["health response was unreadable or exceeded the size limit"]);
  });

  it("does not echo low-level network exceptions", async () => {
    const result = await checkScheduleHealth(async () => {
      throw new Error("private credential should not be echoed");
    }, now);
    expect(result.problems).toEqual(["health endpoint request failed or timed out"]);
    expect(JSON.stringify(result)).not.toContain("private credential");
  });
});
