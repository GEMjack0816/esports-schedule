import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PandaScoreGameSyncState } from "./cache";
import type { PandaGameSnapshot } from "./pandascore";
import type { EsportsMatch, GameCoverage, PandaGameKey } from "./types";
import { pandaEndpointKeys, pandaGameKeys } from "./types";

const dependencies = vi.hoisted(() => ({
  readSnapshots: vi.fn(),
  readStates: vi.fn(),
  readLockStatus: vi.fn(),
  readGenerations: vi.fn(),
  readPersistentSnapshots: vi.fn(),
  getPublishedMatches: vi.fn(),
}));

vi.mock("./cache", () => ({
  acquirePandaScoreSyncLock: vi.fn(),
  readAllPandaScoreGameSnapshots: dependencies.readSnapshots,
  readAllPandaScoreGameSyncStates: dependencies.readStates,
  readPandaScoreSyncLockStatus: dependencies.readLockStatus,
  releasePandaScoreSyncLock: vi.fn(),
  writePandaScoreGameSnapshot: vi.fn(),
  writePandaScoreGameSyncState: vi.fn(),
}));

vi.mock("./persistent-snapshots", () => ({
  allocatePandaScoreSyncGeneration: vi.fn(),
  readPersistentPandaScoreSnapshots: dependencies.readPersistentSnapshots,
  readPersistentPandaScoreSnapshotGenerations: dependencies.readGenerations,
  recordPersistentPandaScoreFailure: vi.fn(),
  writePersistentPandaScoreSnapshot: vi.fn(),
}));

vi.mock("@/lib/review/public-matches", () => ({
  getPublishedDatabaseMatches: dependencies.getPublishedMatches,
}));

import { getSchedule } from "./index";

function coverage(fetchedAt: string): GameCoverage {
  const endpoint = {
    pages: 1,
    xTotal: 0,
    raw: 0,
    normalized: 0,
    deduplicated: 0,
    final: 0,
    filtered: { missingId: 0, missingTime: 0, invalidTime: 0, outsideWindow: 0, duplicate: 0 },
  };
  return {
    endpoints: Object.fromEntries(pandaEndpointKeys.map((key) => [key, endpoint])) as GameCoverage["endpoints"],
    pages: 3,
    xTotal: 0,
    raw: 0,
    normalized: 0,
    deduplicated: 0,
    final: 0,
    statusCounts: { scheduled: 0, running: 0, finished: 0, postponed: 0, cancelled: 0, forfeit: 0, unknown: 0 },
    earliestMatchAt: null,
    latestMatchAt: null,
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
    verificationSample: null,
  };
}

function snapshot(game: PandaGameKey, fetchedAt: string): PandaGameSnapshot {
  return {
    game,
    matches: [{
      id: `pandascore:${game}:fixture`,
      provider: "pandascore",
      providerMatchId: `${game}-fixture`,
      game,
      tournament: "Test tournament",
      league: "Test league",
      stage: null,
      homeTeam: { name: "Alpha", logo: "/team-placeholder.svg" },
      awayTeam: { name: "Beta", logo: "/team-placeholder.svg" },
      homeScore: null,
      awayScore: null,
      bestOf: 3,
      status: "scheduled",
      startTimeUtc: "2026-08-30T01:00:00.000Z",
      streams: [],
      lastUpdatedAt: fetchedAt,
    } satisfies EsportsMatch],
    fetchedAt,
    syncGeneration: 7,
    rateLimitRemaining: 100,
    coverage: coverage(fetchedAt),
  };
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

describe("getSchedule persistence degradation propagation", () => {
  beforeEach(() => {
    vi.stubEnv("PANDASCORE_TOKEN", "test-token");
    const fetchedAt = "2026-08-30T00:00:00.000Z";
    dependencies.readSnapshots.mockResolvedValue(Object.fromEntries(
      pandaGameKeys.map((game) => [game, snapshot(game, fetchedAt)]),
    ));
    dependencies.readStates.mockResolvedValue(Object.fromEntries(
      pandaGameKeys.map((game) => [game, state(game, fetchedAt)]),
    ));
    dependencies.readLockStatus.mockResolvedValue({
      refreshInProgress: false,
      startedAt: null,
      expiresAt: null,
    });
    dependencies.readGenerations.mockResolvedValue({
      generations: {},
      databaseAvailable: false,
      errorCode: "DATABASE_UNAVAILABLE",
    });
    dependencies.readPersistentSnapshots.mockResolvedValue({
      snapshots: {},
      states: {},
      databaseAvailable: false,
      errorCode: "DATABASE_UNAVAILABLE",
    });
    dependencies.getPublishedMatches.mockResolvedValue({ matches: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("marks valid Runtime Cache data stale when the persistent generation check fails", async () => {
    const schedule = await getSchedule({ now: new Date("2026-08-30T00:05:00.000Z") });

    expect(dependencies.readPersistentSnapshots).not.toHaveBeenCalled();
    expect(schedule.mode).toBe("live");
    expect(schedule.stale).toBe(true);
    expect(schedule.providers.pandascore).toBe("stale-cache");
    expect(schedule.warning).toContain("持久快照暂时无法校验");
    expect(schedule.coverage.totals.finalPandaScore).toBe(pandaGameKeys.length);
    expect(schedule.matches.filter((match) => match.provider === "pandascore")).toHaveLength(pandaGameKeys.length);
  });
});
