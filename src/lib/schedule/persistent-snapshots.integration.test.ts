import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PandaScoreGameSyncState } from "./cache";
import { buildScheduleFromParts, recoverScheduleParts } from "./index";
import {
  readPersistentPandaScoreSnapshots,
  recordPersistentPandaScoreFailure,
  writePersistentPandaScoreSnapshot,
} from "./persistent-snapshots";
import type { PandaGameSnapshot } from "./pandascore";
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
    await expect(writePersistentPandaScoreSnapshot(value, state("lol", value.fetchedAt))).resolves.toBe("written");
    const stored = await readPersistentPandaScoreSnapshots(["lol"]);
    expect(stored.snapshots.lol?.matches).toHaveLength(1);
    expect(stored.states.lol?.lastSuccessfulSyncAt).toBe(value.fetchedAt);
  });

  it("prevents an older synchronization from overwriting a newer snapshot", async () => {
    const newer = snapshot("cs2", "2026-08-30T02:00:00.000Z", "newer");
    const older = snapshot("cs2", "2026-08-30T01:00:00.000Z", "older");
    await expect(writePersistentPandaScoreSnapshot(newer, state("cs2", newer.fetchedAt))).resolves.toBe("written");
    await expect(writePersistentPandaScoreSnapshot(older, state("cs2", older.fetchedAt))).resolves.toBe("superseded");
    const stored = await readPersistentPandaScoreSnapshots(["cs2"]);
    expect(stored.snapshots.cs2?.matches[0].providerMatchId).toBe("newer");
  });

  it("does not let an older failure overwrite a newer successful state", async () => {
    const newer = snapshot("valorant", "2026-08-30T02:00:00.000Z", "newer");
    await writePersistentPandaScoreSnapshot(newer, state("valorant", newer.fetchedAt));
    const olderFailure: PandaScoreGameSyncState = {
      game: "valorant",
      lastAttemptAt: "2026-08-30T01:00:00.000Z",
      lastSuccessfulSyncAt: "2026-08-30T00:00:00.000Z",
      lastErrorAt: "2026-08-30T01:00:00.000Z",
      lastErrorCode: "TIMEOUT",
      lastHttpStatus: null,
    };
    await expect(recordPersistentPandaScoreFailure(olderFailure)).resolves.toBe(false);
    const stored = await readPersistentPandaScoreSnapshots(["valorant"]);
    expect(stored.states.valorant?.lastErrorCode).toBeNull();
  });

  it("does not let an older failure overwrite newer failure metadata", async () => {
    const value = snapshot("honor-of-kings", "2026-08-30T00:00:00.000Z", "old");
    await writePersistentPandaScoreSnapshot(value, state("honor-of-kings", value.fetchedAt));
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
    await expect(recordPersistentPandaScoreFailure(newerFailure)).resolves.toBe(true);
    await expect(recordPersistentPandaScoreFailure(olderFailure)).resolves.toBe(false);
    const stored = await readPersistentPandaScoreSnapshots(["honor-of-kings"]);
    expect(stored.states["honor-of-kings"]?.lastErrorCode).toBe("RATE_LIMIT");
  });

  it("preserves the last-known-good payload while recording a newer provider failure", async () => {
    const old = snapshot("dota2", "2026-08-30T00:00:00.000Z", "old");
    await writePersistentPandaScoreSnapshot(old, state("dota2", old.fetchedAt));
    const failure: PandaScoreGameSyncState = {
      game: "dota2",
      lastAttemptAt: "2026-08-30T01:00:00.000Z",
      lastSuccessfulSyncAt: old.fetchedAt,
      lastErrorAt: "2026-08-30T01:00:00.000Z",
      lastErrorCode: "UPSTREAM",
      lastHttpStatus: 500,
    };
    await expect(recordPersistentPandaScoreFailure(failure)).resolves.toBe(true);
    const stored = await readPersistentPandaScoreSnapshots(["dota2"]);
    expect(stored.snapshots.dota2?.matches[0].providerMatchId).toBe("old");
    expect(stored.states.dota2?.lastErrorCode).toBe("UPSTREAM");
  });

  it("recovers the Production incident shape after complete Runtime Cache eviction", async () => {
    for (const [index, game] of pandaGameKeys.entries()) {
      const value = snapshot(game, "2026-08-30T00:00:00.000Z", `${game}-${index}`);
      await expect(writePersistentPandaScoreSnapshot(value, state(game, value.fetchedAt))).resolves.toBe("written");
    }
    const cacheBackfills: PandaGameKey[] = [];
    const recovered = await recoverScheduleParts({}, {}, {
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

  it("rejects a malformed replacement without damaging the good snapshot", async () => {
    const good = snapshot("lol", "2026-08-30T00:00:00.000Z", "good");
    await writePersistentPandaScoreSnapshot(good, state("lol", good.fetchedAt));
    const malformed = { ...good, fetchedAt: "not-a-date" } as PandaGameSnapshot;
    await expect(writePersistentPandaScoreSnapshot(malformed, state("lol", good.fetchedAt)))
      .resolves.toBe("unavailable");
    const stored = await readPersistentPandaScoreSnapshots(["lol"]);
    expect(stored.snapshots.lol?.matches[0].providerMatchId).toBe("good");
  });

  it("fails closed when a stored JSONB payload is malformed", async () => {
    const good = snapshot("lol", "2026-08-30T00:00:00.000Z", "good");
    await writePersistentPandaScoreSnapshot(good, state("lol", good.fetchedAt));
    await cleanup`
      update pandascore_game_snapshots
      set snapshot_payload = ${cleanup.json({ game: "lol", fetchedAt: good.fetchedAt })}
      where game = 'lol'
    `;
    const stored = await readPersistentPandaScoreSnapshots(["lol"]);
    expect(stored.snapshots.lol).toBeUndefined();
  });
});
