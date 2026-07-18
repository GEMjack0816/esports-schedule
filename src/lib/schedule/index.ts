import {
  readAllPandaScoreGameSnapshots,
  readAllPandaScoreGameSyncStates,
  writePandaScoreGameSnapshot,
  writePandaScoreGameSyncState,
} from "./cache";
import type { PandaScoreGameSyncState } from "./cache";
import { applyManualData } from "./manual";
import {
  aggregatePandaScoreSnapshots,
  syncPandaScoreGames,
} from "./pandascore";
import type {
  PandaGameSnapshot,
  PandaScoreResult,
  PandaScoreSyncBatch,
} from "./pandascore";
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

const FRESH_FOR_MS = 15 * 60 * 1_000;
const FAILED_AFTER_MS = 60 * 60 * 1_000;

let inFlightSync: Promise<PandaScoreSyncBatch> | null = null;

type SnapshotMap = Partial<Record<PandaGameKey, PandaGameSnapshot>>;
type SyncStateMap = Partial<Record<PandaGameKey, PandaScoreGameSyncState>>;

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
    forfeit: 0,
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
    lastSuccessfulSyncAt: null,
    lastAttemptAt: null,
    syncStatus: "failed",
    staleMinutes: null,
    dataSource: "unavailable",
    lastErrorCode: null,
  };
}

function maxDate(values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => !!value && !Number.isNaN(Date.parse(value)));
  return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function decorateGames(
  snapshots: SnapshotMap,
  states: SyncStateMap,
  now: Date,
): Record<PandaGameKey, GameCoverage> {
  const games = {} as Record<PandaGameKey, GameCoverage>;
  for (const game of pandaGameKeys) {
    const snapshot = snapshots[game];
    const state = states[game];
    const base = snapshot?.coverage ?? emptyGameCoverage();
    const lastSuccessfulSyncAt = state?.lastSuccessfulSyncAt ?? snapshot?.fetchedAt ?? null;
    const lastAttemptAt = state?.lastAttemptAt ?? lastSuccessfulSyncAt;
    const staleMs = lastSuccessfulSyncAt
      ? Math.max(0, now.getTime() - Date.parse(lastSuccessfulSyncAt))
      : null;
    const failedAttempt = !!state?.lastErrorAt
      && (!lastSuccessfulSyncAt || Date.parse(state.lastErrorAt) >= Date.parse(lastSuccessfulSyncAt));
    const syncStatus = failedAttempt || staleMs === null || staleMs > FAILED_AFTER_MS
      ? "failed"
      : staleMs > FRESH_FOR_MS
        ? "delayed"
        : "normal";

    games[game] = {
      ...base,
      lastSuccessfulSyncAt,
      lastAttemptAt,
      syncStatus,
      staleMinutes: staleMs === null ? null : Math.floor(staleMs / 60_000),
      dataSource: snapshot ? (syncStatus === "normal" ? "fresh" : "cache") : "unavailable",
      lastErrorCode: state?.lastErrorCode ?? null,
    };
  }
  return games;
}

function bounds(matches: EsportsMatch[]) {
  const sorted = matches
    .map((match) => match.startTimeUtc)
    .filter((value): value is string => value !== null)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return { earliest: sorted[0] ?? null, latest: sorted.at(-1) ?? null };
}

function makeCoverage(
  mode: SchedulePayload["mode"],
  stale: boolean,
  now: Date,
  panda: PandaScoreResult | null,
  states: SyncStateMap,
  matches: EsportsMatch[],
  manual: ReturnType<typeof applyManualData>,
): DataCoverage {
  const range = bounds(matches);
  const games = decorateGames(panda?.snapshots ?? {}, states, now);
  return {
    mode,
    stale,
    syncAttemptedAt: maxDate(Object.values(states).map((state) => state?.lastAttemptAt)) ?? now.toISOString(),
    lastSuccessfulSyncAt: maxDate(Object.values(games).map((game) => game.lastSuccessfulSyncAt)),
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
    games,
    manual: {
      honorOfKings: manual.honorOfKingsCount,
      supplemental: manual.supplementalCount,
      overrides: manual.overrideCount,
      hidden: manual.hiddenCount,
      published: manual.honorOfKingsCount + manual.supplementalCount,
    },
  };
}

function buildPayload(
  panda: PandaScoreResult | null,
  states: SyncStateMap,
  mode: SchedulePayload["mode"],
  provider: SchedulePayload["providers"]["pandascore"],
  now: Date,
  warning?: string,
): SchedulePayload {
  const manual = applyManualData(panda?.matches ?? [], now);
  const matches = manual.matches;
  const games = decorateGames(panda?.snapshots ?? {}, states, now);
  const stale = panda
    ? pandaGameKeys.some((game) => games[game].syncStatus !== "normal")
    : true;
  const coverage = makeCoverage(mode, stale, now, panda, states, matches, manual);

  return {
    matches,
    generatedAt: now.toISOString(),
    mode,
    demoMode: false,
    stale,
    lastSuccessfulSyncAt: coverage.lastSuccessfulSyncAt,
    providers: {
      pandascore: provider,
      manual: "json",
    },
    coverage,
    warning,
  };
}

function isFresh(snapshot: PandaGameSnapshot, now: Date): boolean {
  return now.getTime() - Date.parse(snapshot.fetchedAt) < FRESH_FOR_MS;
}

function allGamesFresh(snapshots: SnapshotMap, states: SyncStateMap, now: Date): boolean {
  return pandaGameKeys.every((game) => {
    const snapshot = snapshots[game];
    const state = states[game];
    if (!snapshot || !isFresh(snapshot, now)) return false;
    return !state?.lastErrorAt || Date.parse(state.lastErrorAt) < Date.parse(snapshot.fetchedAt);
  });
}

async function synchronize(token: string, snapshots: SnapshotMap, now: Date): Promise<PandaScoreSyncBatch> {
  if (!inFlightSync) {
    inFlightSync = syncPandaScoreGames(token, snapshots, { now }).finally(() => {
      inFlightSync = null;
    });
  }
  return inFlightSync;
}

async function persistSyncBatch(
  batch: PandaScoreSyncBatch,
  previousStates: SyncStateMap,
  now: Date,
): Promise<SyncStateMap> {
  const nextStates: SyncStateMap = { ...previousStates };
  const operations: Promise<unknown>[] = [];
  for (const game of pandaGameKeys) {
    const snapshot = batch.snapshots[game];
    const failure = batch.failures[game];
    if (batch.updatedGames.includes(game) && snapshot) {
      const state: PandaScoreGameSyncState = {
        game,
        lastAttemptAt: now.toISOString(),
        lastSuccessfulSyncAt: snapshot.fetchedAt,
        lastErrorAt: null,
        lastErrorCode: null,
        lastHttpStatus: null,
      };
      nextStates[game] = state;
      operations.push(writePandaScoreGameSnapshot(snapshot), writePandaScoreGameSyncState(state));
      continue;
    }
    if (failure) {
      const state: PandaScoreGameSyncState = {
        game,
        lastAttemptAt: now.toISOString(),
        lastSuccessfulSyncAt: previousStates[game]?.lastSuccessfulSyncAt ?? snapshot?.fetchedAt ?? null,
        lastErrorAt: now.toISOString(),
        lastErrorCode: failure.code,
        lastHttpStatus: failure.status,
      };
      nextStates[game] = state;
      operations.push(writePandaScoreGameSyncState(state));
      console.error(`[schedule] ${game} sync failed (${failure.code}${failure.status ? ` HTTP ${failure.status}` : ""})`);
    }
  }
  await Promise.allSettled(operations);
  return nextStates;
}

function failureWarning(batch: PandaScoreSyncBatch): string | undefined {
  const failedGames = pandaGameKeys.filter((game) => !!batch.failures[game]);
  if (failedGames.length === 0) return undefined;
  return `部分项目同步失败（${failedGames.join("、")}），已分别保留这些项目上一次成功的真实数据；其他项目已继续更新。`;
}

export async function getSchedule(options: {
  forceRefresh?: boolean;
  cachedOnly?: boolean;
  now?: Date;
} = {}): Promise<SchedulePayload> {
  const now = options.now ?? new Date();
  const token = process.env.PANDASCORE_TOKEN?.trim();
  const cacheReads = await Promise.allSettled([
    readAllPandaScoreGameSnapshots(),
    readAllPandaScoreGameSyncStates(),
  ]);
  const snapshots = cacheReads[0].status === "fulfilled" ? cacheReads[0].value : {};
  let states: SyncStateMap = cacheReads[1].status === "fulfilled" ? cacheReads[1].value : {};
  const cachedPanda = aggregatePandaScoreSnapshots(snapshots);

  if (options.cachedOnly) {
    if (cachedPanda) {
      const games = decorateGames(snapshots, states, now);
      const stale = pandaGameKeys.some((game) => games[game].syncStatus !== "normal");
      return buildPayload(
        cachedPanda,
        states,
        "live",
        stale ? "stale-cache" : "connected",
        now,
        stale ? "一个或多个项目的数据同步延迟，当前继续提供各项目上一次成功的真实数据。" : undefined,
      );
    }
    return buildPayload(
      null,
      states,
      "unavailable",
      token ? "error" : "not-configured",
      now,
      token ? "尚未生成首批真实数据缓存。" : "PandaScore 服务端环境变量尚未配置。",
    );
  }

  if (cachedPanda && !options.forceRefresh && allGamesFresh(snapshots, states, now)) {
    return buildPayload(cachedPanda, states, "live", "connected", now);
  }

  if (token) {
    const batch = await synchronize(token, snapshots, now);
    states = await persistSyncBatch(batch, states, now);
    const panda = aggregatePandaScoreSnapshots(batch.snapshots);
    if (panda) {
      const warning = failureWarning(batch);
      return buildPayload(
        panda,
        states,
        "live",
        warning ? "stale-cache" : "connected",
        now,
        warning,
      );
    }
    return buildPayload(
      null,
      states,
      "unavailable",
      "error",
      now,
      "PandaScore 当前不可用且没有任何项目的历史真实数据；未使用演示比赛替代。",
    );
  }

  if (cachedPanda) {
    return buildPayload(
      cachedPanda,
      states,
      "live",
      "stale-cache",
      now,
      "PandaScore 当前未配置，继续保留各项目上一次成功的真实数据。",
    );
  }

  return buildPayload(
    null,
    states,
    "unavailable",
    "not-configured",
    now,
    "没有可用的 PandaScore 真实数据；生产环境不会使用演示比赛冒充真实数据。",
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
