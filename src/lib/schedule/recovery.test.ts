import { describe, expect, it, vi } from "vitest";
import type { PandaScoreGameSyncState } from "./cache";
import {
  buildScheduleFromParts,
  deriveGameCoverage,
  persistPandaScoreSyncBatch,
  recoverScheduleParts,
  stateAfterFailure,
} from "./index";
import type { PandaGameSnapshot, PandaScoreSyncBatch } from "./pandascore";
import type { EsportsMatch, GameCoverage, PandaGameKey } from "./types";
import { pandaEndpointKeys, pandaGameKeys } from "./types";

function match(game: PandaGameKey, suffix = "1"): EsportsMatch {
  return {
    id: `pandascore:${game}:${suffix}`,
    provider: "pandascore",
    providerMatchId: suffix,
    game,
    tournament: "Test",
    league: "Test League",
    stage: null,
    homeTeam: { name: "A", logo: "/team-placeholder.svg" },
    awayTeam: { name: "B", logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc: "2026-08-31T00:00:00.000Z",
    streams: [],
    lastUpdatedAt: "2026-08-30T00:00:00.000Z",
  };
}

function coverage(game: PandaGameKey, fetchedAt: string): GameCoverage {
  const endpoint = {
    pages: 1,
    xTotal: 1,
    raw: 1,
    normalized: 1,
    deduplicated: 1,
    final: 1,
    filtered: { missingId: 0, missingTime: 0, invalidTime: 0, outsideWindow: 0, duplicate: 0 },
  };
  return {
    endpoints: Object.fromEntries(pandaEndpointKeys.map((key) => [key, endpoint])) as GameCoverage["endpoints"],
    pages: 3,
    xTotal: 3,
    raw: 3,
    normalized: 3,
    deduplicated: 1,
    final: 1,
    statusCounts: { scheduled: 1, running: 0, finished: 0, postponed: 0, cancelled: 0, forfeit: 0, unknown: 0 },
    earliestMatchAt: "2026-08-31T00:00:00.000Z",
    latestMatchAt: "2026-08-31T00:00:00.000Z",
    lastSuccessfulSyncAt: fetchedAt,
    lastAttemptAt: fetchedAt,
    sourceFetchedAt: fetchedAt,
    snapshotAgeSeconds: 0,
    refreshInProgress: false,
    syncStatus: "normal",
    staleMinutes: 0,
    dataSource: "fresh",
    lastErrorCode: null,
    lastError: null,
    verificationSample: {
      providerMatchId: "1",
      endpoint: "upcoming",
      providerTournament: "Test League",
      providerStartTimeUtc: "2026-08-31T00:00:00.000Z",
      normalizedTournament: "Test League",
      normalizedStartTimeUtc: "2026-08-31T00:00:00.000Z",
    },
  };
}

function snapshot(
  game: PandaGameKey,
  fetchedAt = "2026-08-30T00:00:00.000Z",
  syncGeneration = 1,
): PandaGameSnapshot {
  return {
    game,
    matches: [match(game, `${game}-1`)],
    fetchedAt,
    syncGeneration,
    rateLimitRemaining: 900,
    coverage: coverage(game, fetchedAt),
  };
}

function state(game: PandaGameKey, fetchedAt = "2026-08-30T00:00:00.000Z"): PandaScoreGameSyncState {
  return {
    game,
    lastAttemptAt: fetchedAt,
    lastSuccessfulSyncAt: fetchedAt,
    lastErrorAt: null,
    lastErrorCode: null,
    lastHttpStatus: null,
  };
}

describe("persistent schedule recovery", () => {
  it("uses a complete Runtime Cache hit without querying PostgreSQL", async () => {
    const snapshots = Object.fromEntries(pandaGameKeys.map((game) => [game, snapshot(game)]));
    const states = Object.fromEntries(pandaGameKeys.map((game) => [game, state(game)]));
    const readPersistent = vi.fn();
    const readGenerations = vi.fn(async () => ({
      generations: Object.fromEntries(pandaGameKeys.map((game) => [game, 1])),
      databaseAvailable: true,
      errorCode: null,
    }));
    const recovered = await recoverScheduleParts(snapshots, states, {
      readGenerations,
      readPersistent,
      writeRuntimeSnapshot: vi.fn(),
      writeRuntimeState: vi.fn(),
    });
    expect(readGenerations).toHaveBeenCalledOnce();
    expect(readPersistent).not.toHaveBeenCalled();
    expect(recovered.recoveredGames).toEqual([]);
  });

  it("recovers a Runtime Cache miss from a persistent snapshot and backfills cache", async () => {
    const persistentSnapshot = snapshot("lol");
    const persistentState = state("lol");
    const writeRuntimeSnapshot = vi.fn(async () => true);
    const writeRuntimeState = vi.fn(async () => true);
    const recovered = await recoverScheduleParts({}, {}, {
      readGenerations: async () => ({ generations: { lol: 1 }, databaseAvailable: true, errorCode: null }),
      readPersistent: async () => ({
        snapshots: { lol: persistentSnapshot },
        states: { lol: persistentState },
        databaseAvailable: true,
        errorCode: null,
      }),
      writeRuntimeSnapshot,
      writeRuntimeState,
    });
    expect(recovered.snapshots.lol).toBe(persistentSnapshot);
    expect(recovered.snapshotSources.lol).toBe("persistent-snapshot");
    expect(writeRuntimeSnapshot).toHaveBeenCalledWith(persistentSnapshot);
    expect(writeRuntimeState).toHaveBeenCalledWith(persistentState);
  });

  it("remains unavailable only when both Runtime Cache and PostgreSQL have no snapshot", async () => {
    const recovered = await recoverScheduleParts({}, {}, {
      readGenerations: async () => ({ generations: {}, databaseAvailable: true, errorCode: null }),
      readPersistent: async () => ({ snapshots: {}, states: {}, databaseAvailable: true, errorCode: null }),
      writeRuntimeSnapshot: vi.fn(),
      writeRuntimeState: vi.fn(),
    });
    const payload = await buildScheduleFromParts({
      ...recovered,
      refreshInProgress: false,
    }, "configured-token", new Date("2026-08-30T00:10:00.000Z"));
    expect(payload.mode).toBe("unavailable");
    expect(payload.coverage.totals.finalPandaScore).toBe(0);
  });

  it("serves a stale persistent snapshot instead of reporting unavailable", async () => {
    const snapshots = Object.fromEntries(pandaGameKeys.map((game) => [game, snapshot(game)]));
    const states = Object.fromEntries(pandaGameKeys.map((game) => [game, state(game)]));
    const snapshotSources = Object.fromEntries(
      pandaGameKeys.map((game) => [game, "persistent-snapshot" as const]),
    );
    const payload = await buildScheduleFromParts({
      snapshots,
      states,
      snapshotSources,
      refreshInProgress: false,
    }, "configured-token", new Date("2026-08-30T02:00:00.000Z"));
    expect(payload.mode).toBe("live");
    expect(payload.stale).toBe(true);
    expect(payload.coverage.totals.finalPandaScore).toBe(5);
    expect(payload.coverage.games.lol.dataSource).toBe("persistent");
  });

  it("keeps persistent real data available when the provider token is not configured", async () => {
    const snapshots = Object.fromEntries(pandaGameKeys.map((game) => [game, snapshot(game)]));
    const states = Object.fromEntries(pandaGameKeys.map((game) => [game, state(game)]));
    const snapshotSources = Object.fromEntries(
      pandaGameKeys.map((game) => [game, "persistent-snapshot" as const]),
    );
    const payload = await buildScheduleFromParts({
      snapshots,
      states,
      snapshotSources,
      refreshInProgress: false,
    }, undefined, new Date("2026-08-30T00:10:00.000Z"));
    expect(payload.mode).toBe("live");
    expect(payload.providers.pandascore).toBe("not-configured");
    expect(payload.coverage.totals.finalPandaScore).toBe(5);
  });

  it("marks the full schedule stale when one game fails despite a fresh aggregate snapshot time", async () => {
    const fetchedAt = "2026-08-30T00:04:00.000Z";
    const snapshots = Object.fromEntries(pandaGameKeys.map((game) => [game, snapshot(game, fetchedAt)]));
    const states = Object.fromEntries(pandaGameKeys.map((game) => [game, state(game, fetchedAt)]));
    states.lol = stateAfterFailure(
      "lol",
      states.lol,
      snapshots.lol,
      { code: "UPSTREAM", status: 503 },
      new Date("2026-08-30T00:04:30.000Z"),
    );

    const payload = await buildScheduleFromParts({
      snapshots,
      states,
      snapshotSources: {},
      refreshInProgress: false,
    }, "configured-token", new Date("2026-08-30T00:05:00.000Z"));

    expect(payload.coverage.snapshotAgeSeconds).toBe(60);
    expect(payload.coverage.games.lol.syncStatus).toBe("failed");
    expect(payload.coverage.games.valorant.syncStatus).toBe("normal");
    expect(payload.stale).toBe(true);
    expect(payload.providers.pandascore).toBe("stale-cache");
  });
});

describe("durable sync persistence", () => {
  const attemptedStates = Object.fromEntries(pandaGameKeys.map((game) => [game, state(game)]));
  const successfulBatch: PandaScoreSyncBatch = {
    snapshots: Object.fromEntries(pandaGameKeys.map((game) => [game, snapshot(game, "2026-08-30T00:01:00.000Z")])),
    updatedGames: [...pandaGameKeys],
    failures: {},
  };

  it("keeps a successful database write usable when Runtime Cache write fails", async () => {
    const result = await persistPandaScoreSyncBatch(successfulBatch, attemptedStates, new Date("2026-08-30T00:01:01.000Z"), 2, {
      writePersistent: async () => "written",
      recordFailure: async () => true,
      writeRuntimeSnapshot: async () => false,
      writeRuntimeState: async () => true,
    });
    expect(result.snapshotsPersisted).toBe(5);
    expect(result.gamesSucceeded).toBe(5);
    expect(result.generation).toBe(2);
    expect(result.errors).toHaveLength(5);
    expect(result.errors.every((error) => error.code === "CACHE_WRITE")).toBe(true);
  });

  it("does not publish new Runtime Cache data when persistent writes fail", async () => {
    const writeRuntimeSnapshot = vi.fn(async () => true);
    const result = await persistPandaScoreSyncBatch(successfulBatch, attemptedStates, new Date("2026-08-30T00:01:01.000Z"), 2, {
      writePersistent: async () => "unavailable",
      recordFailure: async () => false,
      writeRuntimeSnapshot,
      writeRuntimeState: async () => true,
    });
    expect(result.gamesSucceeded).toBe(0);
    expect(result.gamesFailed).toBe(5);
    expect(result.snapshotsPersisted).toBe(0);
    expect(writeRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it("updates successful games while retaining failed game snapshots", async () => {
    const batch: PandaScoreSyncBatch = {
      snapshots: { ...successfulBatch.snapshots },
      updatedGames: pandaGameKeys.filter((game) => game !== "cs2"),
      failures: { cs2: { game: "cs2", code: "UPSTREAM", status: 500, message: "failed" } },
    };
    const written: PandaGameKey[] = [];
    const result = await persistPandaScoreSyncBatch(batch, attemptedStates, new Date("2026-08-30T00:01:01.000Z"), 2, {
      writePersistent: async (value) => { written.push(value.game); return "written"; },
      recordFailure: async () => true,
      writeRuntimeSnapshot: async () => true,
      writeRuntimeState: async () => true,
    });
    expect(result.gamesSucceeded).toBe(4);
    expect(result.gamesFailed).toBe(1);
    expect(result.generation).toBe(2);
    expect(written).not.toContain("cs2");
  });

  it("preserves every prior snapshot when all providers fail", async () => {
    const batch: PandaScoreSyncBatch = {
      snapshots: { ...successfulBatch.snapshots },
      updatedGames: [],
      failures: Object.fromEntries(pandaGameKeys.map((game) => [game, {
        game,
        code: "NETWORK",
        status: null,
        message: "failed",
      }])),
    };
    const writePersistent = vi.fn();
    const result = await persistPandaScoreSyncBatch(batch, attemptedStates, new Date("2026-08-30T00:01:01.000Z"), 2, {
      writePersistent,
      recordFailure: async () => true,
      writeRuntimeSnapshot: async () => true,
      writeRuntimeState: async () => true,
    });
    expect(result.gamesSucceeded).toBe(0);
    expect(result.gamesFailed).toBe(5);
    expect(result.generation).toBe(2);
    expect(writePersistent).not.toHaveBeenCalled();
  });

});

describe("persistent coverage source", () => {
  it("marks database fallback separately from a fresh Runtime Cache hit", () => {
    const gameSnapshot = snapshot("dota2");
    const games = deriveGameCoverage(
      { dota2: gameSnapshot },
      { dota2: state("dota2") },
      new Date("2026-08-30T00:01:00.000Z"),
      false,
      { dota2: "persistent-snapshot" },
    );
    expect(games.dota2.dataSource).toBe("persistent");
  });
});
