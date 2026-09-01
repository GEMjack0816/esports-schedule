import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PandaScoreGameSyncState } from "./cache";
import { buildScheduleFromParts, persistPandaScoreSyncBatch, recoverScheduleParts } from "./index";
import {
  allocatePandaScoreSyncGeneration,
  readPersistentPandaScoreSnapshots,
  readPersistentPandaScoreSnapshotGenerations,
  recordPersistentPandaScoreFailure,
  writePersistentPandaScoreSnapshot,
} from "./persistent-snapshots";
import type { PandaGameSnapshot, PandaScoreSyncBatch } from "./pandascore";
import type { EsportsMatch, GameCoverage, PandaGameKey } from "./types";
import { pandaGameKeys } from "./types";

const testUrl = process.env.SCHEDULE_TEST_DATABASE_URL?.trim()
  || process.env.REVIEW_TEST_DATABASE_URL?.trim();
const enabled = process.env.ALLOW_REVIEW_DATABASE_TESTS === "1" && !!testUrl;

function snapshot(game: PandaGameKey, fetchedAt: string, suffix: string): PandaGameSnapshot {
  const match: EsportsMatch = {
    id: `pandascore:${game}:${suffix}`,
    provider: "pandascore",
    providerMatchId: suffix,
    game,
    tournament: "Integration",
    league: "Integration League",
    stage: null,
    homeTeam: { name: "A", logo: "/team-placeholder.svg" },
    awayTeam: { name: "B", logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc: "2026-09-01T00:00:00.000Z",
    streams: [],
    lastUpdatedAt: fetchedAt,
  };
  const endpoint = {
    pages: 1,
    xTotal: 1,
    raw: 1,
    normalized: 1,
    deduplicated: 1,
    final: 1,
    filtered: { missingId: 0, missingTime: 0, invalidTime: 0, outsideWindow: 0, duplicate: 0 },
  };
  const coverage: GameCoverage = {
    endpoints: { upcoming: endpoint, running: endpoint, past: endpoint },
    pages: 3,
    xTotal: 3,
    raw: 3,
    normalized: 3,
    deduplicated: 1,
    final: 1,
    statusCounts: { scheduled: 1, running: 0, finished: 0, postponed: 0, cancelled: 0, forfeit: 0, unknown: 0 },
    earliestMatchAt: match.startTimeUtc,
    latestMatchAt: match.startTimeUtc,
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
      providerMatchId: suffix,
      endpoint: "upcoming",
      providerTournament: "Integration League",
      providerStartTimeUtc: match.startTimeUtc,
      normalizedTournament: "Integration League",
      normalizedStartTimeUtc: match.startTimeUtc,
    },
  };
  return { game, matches: [match], fetchedAt, rateLimitRemaining: 900, coverage };
}

function state(game: PandaGameKey, fetchedAt: string): PandaScoreGameSyncState {
  return {
    game,
    lastAttemptAt: fetchedAt,
    lastSuccessfulSyncAt: fetchedAt,
    lastErrorAt: null,
    lastErrorCode: null,
    lastHttpStatus: null,
  };
}

async function nextGeneration(): Promise<number> {
  const generation = await allocatePandaScoreSyncGeneration();
  if (generation === null) throw new Error("failed to allocate isolated test sync generation");
  return generation;
}

describe.skipIf(!enabled)("persistent PandaScore snapshots (isolated PostgreSQL)", () => {
  let cleanup: ReturnType<typeof postgres>;

  beforeAll(() => {
    process.env.DATABASE_URL = testUrl;
    cleanup = postgres(testUrl!, { max: 1, prepare: false });
  });

  beforeEach(async () => {
    await cleanup`delete from pandascore_game_snapshots`;
  });

  afterAll(async () => {
    if (!cleanup) return;
    await cleanup`delete from pandascore_game_snapshots`;
    await cleanup.end();
  });

  it("round-trips a normalized JSONB snapshot and sync metadata", async () => {
    const value = snapshot("lol", "2026-08-30T00:00:00.000Z", randomUUID());
    const generation = await nextGeneration();
    await expect(writePersistentPandaScoreSnapshot(value, state("lol", value.fetchedAt), generation)).resolves.toBe("written");
    const stored = await readPersistentPandaScoreSnapshots(["lol"]);
    expect(stored.snapshots.lol?.matches).toHaveLength(1);
    expect(stored.states.lol?.lastSuccessfulSyncAt).toBe(value.fetchedAt);
    expect(stored.snapshots.lol?.syncGeneration).toBe(generation);
  });

  it("prevents a sync that started first but completed last from overwriting a newer generation", async () => {
    const olderGeneration = await nextGeneration();
    const newerGeneration = await nextGeneration();
    expect(newerGeneration).toBeGreaterThan(olderGeneration);

    const newer = snapshot("cs2", new Date().toISOString(), "newer");
    await expect(writePersistentPandaScoreSnapshot(
      newer,
      state("cs2", newer.fetchedAt),
      newerGeneration,
    )).resolves.toBe("written");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const olderButLate = snapshot("cs2", new Date().toISOString(), "older-but-late");
    expect(Date.parse(olderButLate.fetchedAt)).toBeGreaterThan(Date.parse(newer.fetchedAt));
    await expect(writePersistentPandaScoreSnapshot(
      olderButLate,
      state("cs2", olderButLate.fetchedAt),
      olderGeneration,
    )).resolves.toBe("superseded");
    const stored = await readPersistentPandaScoreSnapshots(["cs2"]);
    expect(stored.snapshots.cs2?.matches[0].providerMatchId).toBe("newer");
    expect(stored.snapshots.cs2?.syncGeneration).toBe(newerGeneration);
  });

  it("does not let an older failure overwrite a newer successful state", async () => {
    const olderFailureGeneration = await nextGeneration();
    const newerSuccessGeneration = await nextGeneration();
    const newer = snapshot("valorant", "2026-08-30T02:00:00.000Z", "newer");
    await writePersistentPandaScoreSnapshot(
      newer,
      state("valorant", newer.fetchedAt),
      newerSuccessGeneration,
    );
    const olderFailure: PandaScoreGameSyncState = {
      game: "valorant",
      lastAttemptAt: "2026-08-30T01:00:00.000Z",
      lastSuccessfulSyncAt: "2026-08-30T00:00:00.000Z",
      lastErrorAt: "2026-08-30T01:00:00.000Z",
      lastErrorCode: "TIMEOUT",
      lastHttpStatus: null,
    };
    await expect(recordPersistentPandaScoreFailure(olderFailure, olderFailureGeneration)).resolves.toBe(false);
    const stored = await readPersistentPandaScoreSnapshots(["valorant"]);
    expect(stored.states.valorant?.lastErrorCode).toBeNull();
  });

  it("does not let an older failure overwrite newer failure metadata", async () => {
    const initialGeneration = await nextGeneration();
    const olderFailureGeneration = await nextGeneration();
    const newerFailureGeneration = await nextGeneration();
    const value = snapshot("honor-of-kings", "2026-08-30T00:00:00.000Z", "old");
    await writePersistentPandaScoreSnapshot(
      value,
      state("honor-of-kings", value.fetchedAt),
      initialGeneration,
    );
    const newerFailure: PandaScoreGameSyncState = {
      game: "honor-of-kings",
      lastAttemptAt: "2026-08-30T02:00:00.000Z",
      lastSuccessfulSyncAt: value.fetchedAt,
      lastErrorAt: "2026-08-30T02:00:00.000Z",
      lastErrorCode: "RATE_LIMIT",
      lastHttpStatus: 429,
    };
    const olderFailure = {
      ...newerFailure,
      lastAttemptAt: "2026-08-30T01:00:00.000Z",
      lastErrorAt: "2026-08-30T01:00:00.000Z",
      lastErrorCode: "TIMEOUT",
      lastHttpStatus: null,
    };
    await expect(recordPersistentPandaScoreFailure(newerFailure, newerFailureGeneration)).resolves.toBe(true);
    await expect(recordPersistentPandaScoreFailure(olderFailure, olderFailureGeneration)).resolves.toBe(false);
    const stored = await readPersistentPandaScoreSnapshots(["honor-of-kings"]);
    expect(stored.states["honor-of-kings"]?.lastErrorCode).toBe("RATE_LIMIT");
  });

  it("preserves the last-known-good payload while recording a newer provider failure", async () => {
    const initialGeneration = await nextGeneration();
    const failureGeneration = await nextGeneration();
    const old = snapshot("dota2", "2026-08-30T00:00:00.000Z", "old");
    await writePersistentPandaScoreSnapshot(old, state("dota2", old.fetchedAt), initialGeneration);
    const failure: PandaScoreGameSyncState = {
      game: "dota2",
      lastAttemptAt: "2026-08-30T01:00:00.000Z",
      lastSuccessfulSyncAt: old.fetchedAt,
      lastErrorAt: "2026-08-30T01:00:00.000Z",
      lastErrorCode: "UPSTREAM",
      lastHttpStatus: 500,
    };
    await expect(recordPersistentPandaScoreFailure(failure, failureGeneration)).resolves.toBe(true);
    const stored = await readPersistentPandaScoreSnapshots(["dota2"]);
    expect(stored.snapshots.dota2?.matches[0].providerMatchId).toBe("old");
    expect(stored.states.dota2?.lastErrorCode).toBe("UPSTREAM");
  });

  it("recovers the Production incident shape after complete Runtime Cache eviction", async () => {
    const generation = await nextGeneration();
    for (const [index, game] of pandaGameKeys.entries()) {
      const value = snapshot(game, "2026-08-30T00:00:00.000Z", `${game}-${index}`);
      await expect(writePersistentPandaScoreSnapshot(value, state(game, value.fetchedAt), generation)).resolves.toBe("written");
    }
    const cacheBackfills: PandaGameKey[] = [];
    const recovered = await recoverScheduleParts({}, {}, {
      readGenerations: readPersistentPandaScoreSnapshotGenerations,
      readPersistent: readPersistentPandaScoreSnapshots,
      writeRuntimeSnapshot: async (value) => { cacheBackfills.push(value.game); return true; },
      writeRuntimeState: async () => true,
    });
    const payload = await buildScheduleFromParts({
      ...recovered,
      refreshInProgress: false,
    }, "configured-token", new Date("2026-08-30T02:00:00.000Z"));
    expect(recovered.recoveredGames).toHaveLength(5);
    expect(cacheBackfills).toHaveLength(5);
    expect(payload.mode).toBe("live");
    expect(payload.stale).toBe(true);
    expect(payload.coverage.totals.finalPandaScore).toBe(5);
  });

  it("replaces old Runtime Cache data when a newer persistent generation survived a cache write failure", async () => {
    const oldGeneration = await nextGeneration();
    const newGeneration = await nextGeneration();
    const oldFetchedAt = "2026-08-30T00:00:00.000Z";
    const newFetchedAt = "2026-08-30T01:00:00.000Z";
    const runtimeSnapshots = {} as Partial<Record<PandaGameKey, PandaGameSnapshot>>;
    const runtimeStates = {} as Partial<Record<PandaGameKey, PandaScoreGameSyncState>>;
    const newSnapshots = {} as Partial<Record<PandaGameKey, PandaGameSnapshot>>;

    for (const game of pandaGameKeys) {
      const oldValue = snapshot(game, oldFetchedAt, `${game}-old`);
      await expect(writePersistentPandaScoreSnapshot(
        oldValue,
        state(game, oldFetchedAt),
        oldGeneration,
      )).resolves.toBe("written");
      runtimeSnapshots[game] = { ...oldValue, syncGeneration: oldGeneration };
      runtimeStates[game] = state(game, oldFetchedAt);
      newSnapshots[game] = snapshot(game, newFetchedAt, `${game}-new`);
    }

    const batch: PandaScoreSyncBatch = {
      snapshots: newSnapshots,
      updatedGames: [...pandaGameKeys],
      failures: {},
    };
    const persisted = await persistPandaScoreSyncBatch(
      batch,
      runtimeStates,
      new Date("2026-08-30T01:00:01.000Z"),
      newGeneration,
      {
        writePersistent: writePersistentPandaScoreSnapshot,
        recordFailure: recordPersistentPandaScoreFailure,
        writeRuntimeSnapshot: async () => false,
        writeRuntimeState: async (value) => {
          runtimeStates[value.game] = value;
          return true;
        },
      },
    );
    expect(persisted.snapshotsPersisted).toBe(5);
    expect(persisted.generation).toBe(newGeneration);
    expect(persisted.errors.every((error) => error.code === "CACHE_WRITE")).toBe(true);

    const cacheBackfills: PandaGameKey[] = [];
    const recovered = await recoverScheduleParts(runtimeSnapshots, runtimeStates, {
      readGenerations: readPersistentPandaScoreSnapshotGenerations,
      readPersistent: readPersistentPandaScoreSnapshots,
      writeRuntimeSnapshot: async (value) => {
        cacheBackfills.push(value.game);
        return true;
      },
      writeRuntimeState: async () => true,
    });
    expect(recovered.recoveredGames).toHaveLength(5);
    expect(cacheBackfills).toHaveLength(5);
    for (const game of pandaGameKeys) {
      expect(recovered.snapshots[game]?.matches[0].providerMatchId).toBe(`${game}-new`);
      expect(recovered.snapshots[game]?.syncGeneration).toBe(newGeneration);
      expect(recovered.snapshots[game]?.syncGeneration).toBe(persisted.generation);
    }

    const payload = await buildScheduleFromParts(
      { ...recovered, refreshInProgress: false },
      "configured-token",
      new Date("2026-08-30T01:00:02.000Z"),
    );
    expect(payload.coverage.totals.finalPandaScore).toBe(5);
    expect(payload.matches
      .filter((value) => value.provider === "pandascore")
      .every((value) => value.providerMatchId.endsWith("-new"))).toBe(true);
  });

  it("rejects a malformed replacement without damaging the good snapshot", async () => {
    const goodGeneration = await nextGeneration();
    const malformedGeneration = await nextGeneration();
    const good = snapshot("lol", "2026-08-30T00:00:00.000Z", "good");
    await writePersistentPandaScoreSnapshot(good, state("lol", good.fetchedAt), goodGeneration);
    const malformed = { ...good, fetchedAt: "not-a-date" } as PandaGameSnapshot;
    await expect(writePersistentPandaScoreSnapshot(
      malformed,
      state("lol", good.fetchedAt),
      malformedGeneration,
    ))
      .resolves.toBe("unavailable");
    const stored = await readPersistentPandaScoreSnapshots(["lol"]);
    expect(stored.snapshots.lol?.matches[0].providerMatchId).toBe("good");
  });

  it("fails closed when a stored JSONB payload is malformed", async () => {
    const generation = await nextGeneration();
    const good = snapshot("lol", "2026-08-30T00:00:00.000Z", "good");
    await writePersistentPandaScoreSnapshot(good, state("lol", good.fetchedAt), generation);
    await cleanup`
      update pandascore_game_snapshots
      set snapshot_payload = ${cleanup.json({ game: "lol", fetchedAt: good.fetchedAt })}
      where game = 'lol'
    `;
    const stored = await readPersistentPandaScoreSnapshots(["lol"]);
    expect(stored.snapshots.lol).toBeUndefined();
  });
});
