import type { PandaGameSnapshot } from "@/lib/schedule/pandascore";
import type { EsportsMatch, PandaGameKey } from "@/lib/schedule/types";

export function testPandaSnapshot(count = 1, game: PandaGameKey = "lol"): PandaGameSnapshot {
  const fetchedAt = "2026-08-30T00:00:00.000Z";
  const startTimeUtc = "2026-08-31T00:00:00.000Z";
  const matches: EsportsMatch[] = Array.from({ length: count }, (_, i) => ({
    id: `pandascore:${game}:${i}`, provider: "pandascore", providerMatchId: String(i), game,
    tournament: "Cache codec test", league: "测试赛程", stage: null,
    homeTeam: { name: `Team ${i}`, logo: "/team-placeholder.svg" },
    awayTeam: { name: `Opponent ${i}`, logo: "/team-placeholder.svg" },
    homeScore: null, awayScore: null, bestOf: 3, status: "scheduled",
    startTimeUtc, streams: [], lastUpdatedAt: fetchedAt,
  }));
  const endpoint = (total: number) => ({
    pages: Math.ceil(total / 100), xTotal: total, raw: total, normalized: total,
    deduplicated: total, final: total,
    filtered: { missingId: 0, missingTime: 0, invalidTime: 0, outsideWindow: 0, duplicate: 0 },
  });
  return {
    game, matches, fetchedAt, syncGeneration: 7, rateLimitRemaining: 900,
    coverage: {
      endpoints: { upcoming: endpoint(count), running: endpoint(0), past: endpoint(0) },
      ...endpoint(count),
      statusCounts: { scheduled: count, running: 0, finished: 0, postponed: 0, cancelled: 0, forfeit: 0, unknown: 0 },
      earliestMatchAt: startTimeUtc, latestMatchAt: startTimeUtc,
      lastSuccessfulSyncAt: fetchedAt, lastAttemptAt: fetchedAt, sourceFetchedAt: fetchedAt,
      snapshotAgeSeconds: 0, refreshInProgress: false, syncStatus: "normal", staleMinutes: 0,
      dataSource: "fresh", lastErrorCode: null, lastError: null,
      verificationSample: {
        providerMatchId: "0", endpoint: "upcoming", providerTournament: "测试赛程",
        providerStartTimeUtc: startTimeUtc, normalizedTournament: "测试赛程",
        normalizedStartTimeUtc: startTimeUtc,
      },
    },
  };
}
