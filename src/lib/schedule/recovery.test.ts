import { afterEach, describe, expect, it, vi } from "vitest";
import type { PandaScoreGameSyncState } from "./cache";
import {
  buildScheduleFromParts,
  deriveGameCoverage,
  persistPandaScoreSyncBatch,
  recoverScheduleParts,
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
  afterEach(() => vi.useRealTimers());

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

  it("never replaces a newer Runtime Cache snapshot with an older persistent generation", async () => {
    const runtimeSnapshot = snapshot("lol", "2026-08-30T01:00:00.000Z", 5);
    runtimeSnapshot.matches = [match("lol", "runtime-new")];
    const persistentSnapshot = snapshot("lol", "2026-08-30T00:00:00.000Z", 4);
    persistentSnapshot.matches = [match("lol", "persistent-old")];
    const writeRuntimeSnapshot = vi.fn(async () => true);
    const writeRuntimeState = vi.fn(async () => true);

    const recovered = await recoverScheduleParts({ lol: runtimeSnapshot }, {}, {
      readGenerations: async () => ({
        generations: { lol: 4 },
        databaseAvailable: true,
        errorCode: null,
      }),
      readPersistent: async () => ({
        snapshots: { lol: persistentSnapshot },
        states: { lol: state("lol", persistentSnapshot.fetchedAt) },
        databaseAvailable: true,
        errorCode: null,
      }),
      writeRuntimeSnapshot,
      writeRuntimeState,
    });

    expect(recovered.snapshots.lol?.matches[0].providerMatchId).toBe("runtime-new");
    expect(recovered.snapshots.lol?.syncGeneration).toBe(5);
    expect(recovered.snapshotSources.lol).toBe("runtime-cache");
    expect(recovered.recoveredGames).toEqual([]);
    expect(writeRuntimeSnapshot).not.toHaveBeenCalled();
    expect(writeRuntimeState).not.toHaveBeenCalled();
  });

  it("serves valid Runtime Cache data as degraded when PostgreSQL cannot be checked", async () => {
    const snapshots = Object.fromEntries(
      pandaGameKeys.map((game) => [game, snapshot(game, "2026-08-30T00:00:00.000Z", 5)]),
    );
    const states = Object.fromEntries(
      pandaGameKeys.map((game) => [game, state(game, "2026-08-30T00:00:00.000Z")]),
    );
    const readPersistent = vi.fn();
    const recovered = await recoverScheduleParts(snapshots, states, {
      readGenerations: async () => ({
        generations: {},
        databaseAvailable: false,
        errorCode: "DATABASE_UNAVAILABLE",
      }),
      readPersistent,
      writeRuntimeSnapshot: vi.fn(),
      writeRuntimeState: vi.fn(),
    });
    const payload = await buildScheduleFromParts(
      { ...recovered, refreshInProgress: false },
      "configured-token",
      new Date("2026-08-30T00:10:00.000Z"),
    );

    expect(readPersistent).not.toHaveBeenCalled();
    expect(recovered.persistentStoreAvailable).toBe(false);
    expect(payload.mode).toBe("live");
    expect(payload.stale).toBe(true);
    expect(payload.providers.pandascore).toBe("stale-cache");
    expect(payload.coverage.totals.finalPandaScore).toBe(5);
    expect(payload.warning).toContain("Runtime Cache");
  });

  it("bounds a hung PostgreSQL generation check before returning Runtime Cache data", async () => {
    vi.useFakeTimers();
    const snapshots = Object.fromEntries(
      pandaGameKeys.map((game) => [game, snapshot(game, "2026-08-30T00:00:00.000Z", 5)]),
    );
    const states = Object.fromEntries(
      pandaGameKeys.map((game) => [game, state(game, "2026-08-30T00:00:00.000Z")]),
    );
    const readPersistent = vi.fn();
    const pending = recoverScheduleParts(snapshots, states, {
      readGenerations: () => new Promise(() => undefined),
      readPersistent,
      writeRuntimeSnapshot: vi.fn(),
      writeRuntimeState: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(2_499);
    let settled = false;
    void pending.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const recovered = await pending;
    expect(recovered.persistentStoreAvailable).toBe(false);
    expect(recovered.snapshots.lol?.syncGeneration).toBe(5);
    expect(readPersistent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a hung full persistent snapshot read after a Runtime Cache miss", async () => {
    vi.useFakeTimers();
    const pending = recoverScheduleParts({}, {}, {
      readGenerations: async () => ({
        generations: { lol: 5 },
        databaseAvailable: true,
        errorCode: null,
      }),
      readPersistent: () => new Promise(() => undefined),
      writeRuntimeSnapshot: vi.fn(),
      writeRuntimeState: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(2_500);
    const recovered = await pending;
    expect(recovered.persistentStoreAvailable).toBe(false);
    expect(recovered.snapshots).toEqual({});
    expect(recovered.recoveredGames).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
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
