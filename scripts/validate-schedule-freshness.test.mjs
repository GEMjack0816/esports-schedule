import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_AGE_SECONDS, PANDA_GAMES, validateScheduleFreshness } from "./validate-schedule-freshness.mjs";

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

describe("schedule freshness monitor validation", () => {
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

  it("checks each game's source and success timestamps rather than the aggregate maximum", () => {
    const games = health().games;
    const oldTime = new Date(now - 16 * 60_000).toISOString();
    games.valorant = { ...games.valorant, lastSuccessfulSyncAt: oldTime };
    expect(validateScheduleFreshness(health({ games }), 200, now).message)
      .toContain("valorant lastSuccessfulSyncAt is 960s old");
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
      .toBe("health response has no valid lastSuccessfulSyncAt");
  });
});
