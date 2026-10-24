import { describe, expect, it } from "vitest";
import { isSchedulePayload } from "./payload-guard";
import { gameKeys } from "./types";

function validPayload() {
  const emptyEndpoint = {
    pages: 0,
    xTotal: 0,
    raw: 0,
    normalized: 0,
    deduplicated: 0,
    final: 0,
    filtered: { missingId: 0, missingTime: 0, invalidTime: 0, outsideWindow: 0, duplicate: 0 },
  };
  const emptyGame = {
    endpoints: { upcoming: emptyEndpoint, running: emptyEndpoint, past: emptyEndpoint },
    pages: 0,
    xTotal: 0,
    raw: 0,
    normalized: 0,
    deduplicated: 0,
    final: 0,
    statusCounts: { scheduled: 0, running: 0, finished: 0, postponed: 0, cancelled: 0, forfeit: 0, unknown: 0 },
    earliestMatchAt: null,
    latestMatchAt: null,
    lastSuccessfulSyncAt: null,
    lastAttemptAt: null,
    sourceFetchedAt: null,
    snapshotAgeSeconds: null,
    refreshInProgress: false,
    syncStatus: "normal",
    staleMinutes: null,
    dataSource: "fresh",
    lastErrorCode: null,
    lastError: null,
  };
  return {
    matches: [],
    generatedAt: "2026-10-24T00:00:00.000Z",
    mode: "live",
    demoMode: false,
    stale: false,
    lastSuccessfulSyncAt: null,
    providers: { pandascore: "connected", manual: "json+database" },
    coverage: {
      mode: "live",
      stale: false,
      syncAttemptedAt: null,
      sourceFetchedAt: null,
      lastAttemptAt: null,
      lastSuccessfulSyncAt: null,
      snapshotAgeSeconds: null,
      refreshInProgress: false,
      lastError: null,
      rateLimitRemaining: null,
      range: { pastDays: 30, futureDays: 60, earliestMatchAt: null, latestMatchAt: null },
      totals: { xTotal: 0, raw: 0, normalized: 0, deduplicated: 0, finalPandaScore: 0, finalWithManual: 0, filtered: 0 },
      games: Object.fromEntries(gameKeys.map((game) => [game, emptyGame])),
      manual: { honorOfKings: 0, supplemental: 0, overrides: 0, hidden: 0, published: 0, database: 0 },
    },
    deployment: { id: null, commitSha: null, productionUrl: null, environment: "preview" },
  };
}

describe("isSchedulePayload", () => {
  it("accepts a structurally valid empty schedule", () => {
    expect(isSchedulePayload(validPayload())).toBe(true);
  });

  it.each([null, [], "not-json-shape", { matches: null }])("rejects malformed top-level values", (value) => {
    expect(isSchedulePayload(value)).toBe(false);
  });

  it("rejects malformed matches before the dashboard can render them", () => {
    expect(isSchedulePayload({ ...validPayload(), matches: [{ status: "running" }] })).toBe(false);
  });

  it("rejects invalid timestamps before date formatting can crash the dashboard", () => {
    const payload = validPayload();
    const invalidMatch = {
      id: "manual:1",
      provider: "manual",
      providerMatchId: "1",
      game: "lol",
      tournament: null,
      league: "Test",
      stage: null,
      homeTeam: { name: "A", logo: "/team-placeholder.svg" },
      awayTeam: { name: "B", logo: "/team-placeholder.svg" },
      homeScore: null,
      awayScore: null,
      bestOf: null,
      status: "scheduled",
      startTimeUtc: "not-a-date",
      streams: [],
      lastUpdatedAt: "2026-10-24T00:00:00.000Z",
    };

    expect(isSchedulePayload({ ...payload, matches: [invalidMatch] })).toBe(false);
    expect(isSchedulePayload({
      ...payload,
      coverage: {
        ...payload.coverage,
        range: { ...payload.coverage.range, earliestMatchAt: "not-a-date" },
      },
    })).toBe(false);
    expect(isSchedulePayload({
      ...payload,
      coverage: { ...payload.coverage, sourceFetchedAt: "not-a-date" },
    })).toBe(false);
  });


  it("rejects incomplete per-game coverage", () => {
    const payload = validPayload();
    delete payload.coverage.games.dota2;
    expect(isSchedulePayload(payload)).toBe(false);
  });

  it("rejects a coverage mode that conflicts with the top-level mode", () => {
    const payload = validPayload();
    payload.coverage.mode = "unavailable";
    expect(isSchedulePayload(payload)).toBe(false);
  });

  it("rejects a coverage stale flag that conflicts with the top-level stale flag", () => {
    const payload = validPayload();
    payload.coverage.stale = true;
    expect(isSchedulePayload(payload)).toBe(false);
  });

  it("rejects incomplete totals, provider metadata, and malformed optional warning text", () => {
    expect(isSchedulePayload({ ...validPayload(), coverage: { ...validPayload().coverage, totals: {} } })).toBe(false);
    expect(isSchedulePayload({ ...validPayload(), providers: { pandascore: "connected", manual: "unknown" } })).toBe(false);
    expect(isSchedulePayload({ ...validPayload(), warning: { message: "unexpected object" } })).toBe(false);
  });
});
