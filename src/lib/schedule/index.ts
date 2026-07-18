import {
  readLastSuccessfulPandaScore,
  readPandaScoreSyncState,
  writeLastSuccessfulPandaScore,
  writePandaScoreSyncState,
} from "./cache";
import { getDemoMatches } from "./demo";
import { getManualMatches } from "./manual";
import { getPandaScoreMatches } from "./pandascore";
import type { PandaScoreResult } from "./pandascore";
import type {
  DataCoverage,
  EndpointCoverage,
  EsportsMatch,
  GameCoverage,
  MatchStatus,
  PandaEndpointKey,
  PandaGameKey,
  SchedulePayload,
} from "./types";
import { pandaEndpointKeys, pandaGameKeys } from "./types";
import { uniqueAndSort } from "./utils";

const FRESH_FOR_MS = 15 * 60 * 1_000;

let inFlightSync: Promise<PandaScoreResult> | null = null;

function emptyEndpointCoverage(): EndpointCoverage {
  return {
    pages: 0,
    xTotal: 0,
    raw: 0,
    normalized: 0,
    deduplicated: 0,
    final: 0,
    filtered: {
      missingId: 0,
      missingTime: 0,
      invalidTime: 0,
      outsideWindow: 0,
      duplicate: 0,
    },
  };
}

function emptyGameCoverage(): GameCoverage {
  const endpoints = {} as Record<PandaEndpointKey, EndpointCoverage>;
  for (const endpoint of pandaEndpointKeys) endpoints[endpoint] = emptyEndpointCoverage();
  const statusCounts: Record<MatchStatus, number> = {
    upcoming: 0,
    running: 0,
    finished: 0,
    postponed: 0,
    canceled: 0,
  };
  return {
    endpoints,
    pages: 0,
    xTotal: 0,
    raw: 0,
    normalized: 0,
    deduplicated: 0,
    final: 0,
    statusCounts,
    earliestMatchAt: null,
    latestMatchAt: null,
  };
}

function emptyGames(): Record<PandaGameKey, GameCoverage> {
  const games = {} as Record<PandaGameKey, GameCoverage>;
  for (const game of pandaGameKeys) games[game] = emptyGameCoverage();
  return games;
}

function bounds(matches: EsportsMatch[]) {
  if (matches.length === 0) return { earliest: null, latest: null };
  const sorted = [...matches].sort(
    (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
  );
  return {
    earliest: sorted[0].scheduledAt,
    latest: sorted.at(-1)?.scheduledAt ?? null,
  };
}

function makeCoverage(
  mode: SchedulePayload["mode"],
  stale: boolean,
  syncAttemptedAt: string,
  panda: PandaScoreResult | null,
  matches: EsportsMatch[],
  manual: ReturnType<typeof getManualMatches>,
): DataCoverage {
  const range = bounds(matches);
  return {
    mode,
    stale,
    syncAttemptedAt,
    lastSuccessfulSyncAt: panda?.fetchedAt ?? null,
    rateLimitRemaining: panda?.rateLimitRemaining ?? null,
    range: {
      pastDays: 30,
      futureDays: 60,
      earliestMatchAt: range.earliest,
      latestMatchAt: range.latest,
    },
    totals: {
      xTotal: panda?.totals.xTotal ?? 0,
      raw: panda?.totals.raw ?? 0,
      normalized: panda?.totals.normalized ?? 0,
      deduplicated: panda?.totals.deduplicated ?? 0,
      finalPandaScore: panda?.totals.final ?? 0,
      finalWithManual: matches.length,
      filtered: panda ? panda.totals.raw - panda.totals.final : 0,
    },
    games: panda?.games ?? emptyGames(),
    manual: {
      honorOfKings: manual.honorOfKingsCount,
      supplemental: manual.supplementalCount,
      published: manual.matches.length,
    },
  };
}

function buildPayload(
  panda: PandaScoreResult | null,
  mode: SchedulePayload["mode"],
  provider: SchedulePayload["providers"]["pandascore"],
  stale: boolean,
  now: Date,
  warning?: string,
): SchedulePayload {
  const manual = getManualMatches(now);
  const base = mode === "demo" ? getDemoMatches() : panda?.matches ?? [];
  const matches = uniqueAndSort([...base, ...manual.matches]);
  const generatedAt = now.toISOString();

  return {
    matches,
    generatedAt,
    mode,
    demoMode: mode === "demo",
    stale,
    lastSuccessfulSyncAt: panda?.fetchedAt ?? null,
    providers: {
      pandascore: provider,
      manual: "json",
    },
    coverage: makeCoverage(mode, stale, generatedAt, panda, matches, manual),
    warning,
  };
}

function isFresh(result: PandaScoreResult, now: Date): boolean {
  return now.getTime() - Date.parse(result.fetchedAt) < FRESH_FOR_MS;
}

async function synchronize(token: string, now: Date): Promise<PandaScoreResult> {
  if (!inFlightSync) {
    inFlightSync = getPandaScoreMatches(token, { now }).finally(() => {
      inFlightSync = null;
    });
  }
  return inFlightSync;
}

export async function getSchedule(options: {
  forceRefresh?: boolean;
  cachedOnly?: boolean;
  now?: Date;
} = {}): Promise<SchedulePayload> {
  const now = options.now ?? new Date();
  const token = process.env.PANDASCORE_TOKEN?.trim();
  const [cached, syncState] = await Promise.all([
    readLastSuccessfulPandaScore(),
    readPandaScoreSyncState(),
  ]);

  if (options.cachedOnly) {
    if (cached) {
      const stale = !!syncState?.lastErrorAt
        && Date.parse(syncState.lastErrorAt) >= Date.parse(cached.fetchedAt);
      return buildPayload(
        cached,
        "live",
        stale ? "stale-cache" : "connected",
        stale,
        now,
        stale ? "最近一次 PandaScore 同步失败，当前保留上次成功的真实数据。" : undefined,
      );
    }
    return token
      ? buildPayload(
          null,
          "unavailable",
          "error",
          true,
          now,
          "尚未生成首次真实数据缓存，请先访问赛程接口触发同步。",
        )
      : buildPayload(
          null,
          "demo",
          "not-configured",
          false,
          now,
          "此环境从未成功同步 PandaScore，当前展示演示数据与已审核人工数据。",
        );
  }

  if (cached && !options.forceRefresh && isFresh(cached, now)) {
    return buildPayload(cached, "live", "connected", false, now);
  }

  if (token) {
    try {
      const live = await synchronize(token, now);
      await Promise.all([
        writeLastSuccessfulPandaScore(live),
        writePandaScoreSyncState({ lastAttemptAt: now.toISOString(), lastErrorAt: null }),
      ]);
      return buildPayload(live, "live", "connected", false, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown PandaScore failure";
      console.error(`[schedule] PandaScore sync failed: ${message}`);
      await writePandaScoreSyncState({
        lastAttemptAt: now.toISOString(),
        lastErrorAt: now.toISOString(),
      });
      if (cached) {
        return buildPayload(
          cached,
          "live",
          "stale-cache",
          true,
          now,
          "PandaScore 暂时不可用，当前保留最近一次成功同步的真实数据，数据可能已过期。",
        );
      }
      return buildPayload(
        null,
        "unavailable",
        "error",
        true,
        now,
        "PandaScore 暂时不可用，且没有可用的历史真实数据；当前仅展示已审核人工数据。",
      );
    }
  }

  if (cached) {
    return buildPayload(
      cached,
      "live",
      "stale-cache",
      true,
      now,
      "PandaScore 当前未配置，正在保留最近一次成功同步的真实数据。",
    );
  }

  return buildPayload(
    null,
    "demo",
    "not-configured",
    false,
    now,
    "此环境从未成功同步 PandaScore，当前展示演示数据与已审核人工数据。",
  );
}

export type {
  DataCoverage,
  EsportsMatch,
  GameKey,
  MatchStatus,
  PandaGameKey,
  SchedulePayload,
} from "./types";
