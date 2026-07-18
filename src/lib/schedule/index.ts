import {
  acquirePandaScoreSyncLock,
  readAllPandaScoreGameSnapshots,
  readAllPandaScoreGameSyncStates,
  readPandaScoreSyncLockStatus,
  releasePandaScoreSyncLock,
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
  PandaSyncFailure,
} from "./pandascore";
import { createSingleFlight } from "./single-flight";
import type {
  DataCoverage,
  EndpointCoverage,
  EsportsMatch,
  GameCoverage,
  MatchStatus,
  PandaEndpointKey,
  PandaGameKey,
  SchedulePayload,
  SyncErrorInfo,
} from "./types";
import { pandaEndpointKeys, pandaGameKeys } from "./types";

export const FRESH_FOR_MS = 15 * 60 * 1_000;
const FAILED_AFTER_MS = 60 * 60 * 1_000;

type SnapshotMap = Partial<Record<PandaGameKey, PandaGameSnapshot>>;
type SyncStateMap = Partial<Record<PandaGameKey, PandaScoreGameSyncState>>;
type RefreshResult = {
  batch: PandaScoreSyncBatch | null;
  states: SyncStateMap;
};

const refreshSingleFlight = createSingleFlight<RefreshResult>();

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

function emptyStatusCounts(): Record<MatchStatus, number> {
  return {
    scheduled: 0,
    running: 0,
    finished: 0,
    postponed: 0,
    cancelled: 0,
    forfeit: 0,
    unknown: 0,
  };
}

function emptyGameCoverage(): GameCoverage {
  const endpoints = {} as Record<PandaEndpointKey, EndpointCoverage>;
  for (const endpoint of pandaEndpointKeys) endpoints[endpoint] = emptyEndpointCoverage();
  return {
    endpoints,
    pages: 0,
    xTotal: 0,
    raw: 0,
    normalized: 0,
    deduplicated: 0,
    final: 0,
    statusCounts: emptyStatusCounts(),
    earliestMatchAt: null,
    latestMatchAt: null,
    lastSuccessfulSyncAt: null,
    lastAttemptAt: null,
    sourceFetchedAt: null,
    snapshotAgeSeconds: null,
    refreshInProgress: false,
    syncStatus: "failed",
    staleMinutes: null,
    dataSource: "unavailable",
    lastErrorCode: null,
    lastError: null,
    verificationSample: null,
  };
}

function validDates(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => !!value && !Number.isNaN(Date.parse(value)));
}

function maxDate(values: Array<string | null | undefined>): string | null {
  return validDates(values).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function minDate(values: Array<string | null | undefined>): string | null {
  return validDates(values).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

function errorFromState(state: PandaScoreGameSyncState | undefined): SyncErrorInfo | null {
  if (!state?.lastErrorAt || !state.lastErrorCode) return null;
  return {
    at: state.lastErrorAt,
    code: state.lastErrorCode,
    httpStatus: state.lastHttpStatus,
  };
}

export function deriveGameCoverage(
  snapshots: SnapshotMap,
  states: SyncStateMap,
  now: Date,
  refreshInProgress: boolean,
): Record<PandaGameKey, GameCoverage> {
  const games = {} as Record<PandaGameKey, GameCoverage>;
  for (const game of pandaGameKeys) {
    const snapshot = snapshots[game];
    const state = states[game];
    const base = snapshot?.coverage ?? emptyGameCoverage();
    const sourceFetchedAt = snapshot?.fetchedAt ?? null;
    const lastSuccessfulSyncAt = state?.lastSuccessfulSyncAt ?? sourceFetchedAt;
    const lastAttemptAt = state?.lastAttemptAt ?? lastSuccessfulSyncAt;
    const snapshotAgeMs = sourceFetchedAt
      ? Math.max(0, now.getTime() - Date.parse(sourceFetchedAt))
      : null;
    const failedAttempt = !!state?.lastErrorAt
      && (!sourceFetchedAt || Date.parse(state.lastErrorAt) >= Date.parse(sourceFetchedAt));
    const syncStatus = failedAttempt || snapshotAgeMs === null || snapshotAgeMs > FAILED_AFTER_MS
      ? "failed"
      : snapshotAgeMs > FRESH_FOR_MS
        ? "delayed"
        : "normal";

    games[game] = {
      ...base,
      lastSuccessfulSyncAt,
      lastAttemptAt,
      sourceFetchedAt,
      snapshotAgeSeconds: snapshotAgeMs === null ? null : Math.floor(snapshotAgeMs / 1_000),
      refreshInProgress,
      syncStatus,
      staleMinutes: snapshotAgeMs === null ? null : Math.floor(snapshotAgeMs / 60_000),
      dataSource: snapshot ? (syncStatus === "normal" ? "fresh" : "cache") : "unavailable",
      lastErrorCode: state?.lastErrorCode ?? null,
      lastError: errorFromState(state),
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

function mostRecentError(states: SyncStateMap): SyncErrorInfo | null {
  const errors = Object.values(states)
    .map(errorFromState)
    .filter((value): value is SyncErrorInfo => value !== null)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return errors[0] ?? null;
}

function makeCoverage(
  mode: SchedulePayload["mode"],
  stale: boolean,
  now: Date,
  panda: PandaScoreResult | null,
  states: SyncStateMap,
  matches: EsportsMatch[],
  manual: ReturnType<typeof applyManualData>,
  refreshInProgress: boolean,
): DataCoverage {
  const range = bounds(matches);
  const snapshots = panda?.snapshots ?? {};
  const games = deriveGameCoverage(snapshots, states, now, refreshInProgress);
  const lastAttemptAt = maxDate(Object.values(states).map((state) => state?.lastAttemptAt));
  const sourceFetchedAt = minDate(pandaGameKeys.map((game) => snapshots[game]?.fetchedAt));
  const snapshotAgeSeconds = sourceFetchedAt
    ? Math.floor(Math.max(0, now.getTime() - Date.parse(sourceFetchedAt)) / 1_000)
    : null;
  return {
    mode,
    stale,
    syncAttemptedAt: lastAttemptAt,
    lastAttemptAt,
    lastSuccessfulSyncAt: maxDate(Object.values(games).map((game) => game.lastSuccessfulSyncAt)),
    sourceFetchedAt,
    snapshotAgeSeconds,
    refreshInProgress,
    lastError: mostRecentError(states),
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
  refreshInProgress: boolean,
  warning?: string,
): SchedulePayload {
  const manual = applyManualData(panda?.matches ?? [], now);
  const matches = manual.matches;
  const games = deriveGameCoverage(panda?.snapshots ?? {}, states, now, refreshInProgress);
  const stale = panda
    ? pandaGameKeys.some((game) => games[game].syncStatus !== "normal")
    : true;
  const coverage = makeCoverage(mode, stale, now, panda, states, matches, manual, refreshInProgress);

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
    deployment: {
      id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
      environment: process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV ?? null,
    },
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
    if (!snapshot || !snapshot.coverage.verificationSample || !isFresh(snapshot, now)) return false;
    return !state?.lastErrorAt || Date.parse(state.lastErrorAt) < Date.parse(snapshot.fetchedAt);
  });
}

export function stateAtAttempt(
  game: PandaGameKey,
  previous: PandaScoreGameSyncState | undefined,
  snapshot: PandaGameSnapshot | undefined,
  now: Date,
): PandaScoreGameSyncState {
  return {
    game,
    lastAttemptAt: now.toISOString(),
    lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt ?? snapshot?.fetchedAt ?? null,
    lastErrorAt: previous?.lastErrorAt ?? null,
    lastErrorCode: previous?.lastErrorCode ?? null,
    lastHttpStatus: previous?.lastHttpStatus ?? null,
  };
}

export function stateAfterFailure(
  game: PandaGameKey,
  previous: PandaScoreGameSyncState | undefined,
  snapshot: PandaGameSnapshot | undefined,
  failure: Pick<PandaSyncFailure, "code" | "status">,
  now: Date,
): PandaScoreGameSyncState {
  return {
    game,
    lastAttemptAt: now.toISOString(),
    lastSuccessfulSyncAt: previous
      ? previous.lastSuccessfulSyncAt
      : snapshot?.fetchedAt ?? null,
    lastErrorAt: now.toISOString(),
    lastErrorCode: failure.code,
    lastHttpStatus: failure.status,
  };
}

export function stateAfterSuccess(
  game: PandaGameKey,
  snapshot: PandaGameSnapshot,
  now: Date,
): PandaScoreGameSyncState {
  return {
    game,
    lastAttemptAt: now.toISOString(),
    lastSuccessfulSyncAt: snapshot.fetchedAt,
    lastErrorAt: null,
    lastErrorCode: null,
    lastHttpStatus: null,
  };
}

async function markSyncAttemptStarted(
  snapshots: SnapshotMap,
  previousStates: SyncStateMap,
  now: Date,
): Promise<SyncStateMap> {
  const states: SyncStateMap = { ...previousStates };
  await Promise.allSettled(pandaGameKeys.map(async (game) => {
    const state = stateAtAttempt(game, previousStates[game], snapshots[game], now);
    states[game] = state;
    await writePandaScoreGameSyncState(state);
  }));
  return states;
}

async function persistSyncBatch(
  batch: PandaScoreSyncBatch,
  attemptedStates: SyncStateMap,
  now: Date,
): Promise<SyncStateMap> {
  const nextStates: SyncStateMap = { ...attemptedStates };
  await Promise.allSettled(pandaGameKeys.map(async (game) => {
    const snapshot = batch.snapshots[game];
    const failure = batch.failures[game];
    if (batch.updatedGames.includes(game) && snapshot) {
      const snapshotWritten = await writePandaScoreGameSnapshot(snapshot);
      if (snapshotWritten) {
        const state = stateAfterSuccess(game, snapshot, now);
        nextStates[game] = state;
        await writePandaScoreGameSyncState(state);
        return;
      }
      const cacheFailure = stateAfterFailure(
        game,
        attemptedStates[game],
        snapshot,
        { code: "CACHE_WRITE", status: null },
        now,
      );
      nextStates[game] = cacheFailure;
      await writePandaScoreGameSyncState(cacheFailure);
      return;
    }
    if (failure) {
      const state = stateAfterFailure(game, attemptedStates[game], snapshot, failure, now);
      nextStates[game] = state;
      await writePandaScoreGameSyncState(state);
      console.error(`[schedule] ${game} sync failed (${failure.code}${failure.status ? ` HTTP ${failure.status}` : ""})`);
    }
  }));
  return nextStates;
}

async function persistUnexpectedFailure(
  snapshots: SnapshotMap,
  states: SyncStateMap,
  now: Date,
): Promise<SyncStateMap> {
  const nextStates: SyncStateMap = { ...states };
  await Promise.allSettled(pandaGameKeys.map(async (game) => {
    const state = stateAfterFailure(
      game,
      states[game],
      snapshots[game],
      { code: "UNEXPECTED_SYNC_ERROR", status: null },
      now,
    );
    nextStates[game] = state;
    await writePandaScoreGameSyncState(state);
  }));
  console.error("[schedule] PandaScore refresh stopped by an unexpected error");
  return nextStates;
}

async function synchronize(
  token: string,
  snapshots: SnapshotMap,
  previousStates: SyncStateMap,
  now: Date,
): Promise<RefreshResult> {
  return refreshSingleFlight.run(async () => {
    const lockOwner = await acquirePandaScoreSyncLock(now);
    if (!lockOwner) {
      console.info("[schedule] sync skipped because another regional instance owns the refresh lock");
      return { batch: null, states: previousStates };
    }

    console.info("[schedule] regional refresh lock acquired");
    let states = await markSyncAttemptStarted(snapshots, previousStates, now);
    try {
      const batch = await syncPandaScoreGames(token, snapshots, { now });
      states = await persistSyncBatch(batch, states, now);
      return { batch, states };
    } catch {
      states = await persistUnexpectedFailure(snapshots, states, now);
      return { batch: null, states };
    } finally {
      await releasePandaScoreSyncLock(lockOwner);
    }
  });
}

function failureWarning(batch: PandaScoreSyncBatch): string | undefined {
  const failedGames = pandaGameKeys.filter((game) => !!batch.failures[game]);
  if (failedGames.length === 0) return undefined;
  return `部分项目同步失败（${failedGames.join("、")}），已分别保留这些项目上一次成功的真实数据；其他项目已继续更新。`;
}

async function readScheduleParts(now: Date) {
  const reads = await Promise.allSettled([
    readAllPandaScoreGameSnapshots(),
    readAllPandaScoreGameSyncStates(),
    readPandaScoreSyncLockStatus(now),
  ]);
  return {
    snapshots: reads[0].status === "fulfilled" ? reads[0].value : {},
    states: reads[1].status === "fulfilled" ? reads[1].value : {},
    refreshInProgress: refreshSingleFlight.isRunning()
      || (reads[2].status === "fulfilled" && reads[2].value.refreshInProgress),
  };
}

export async function getSchedule(options: {
  forceRefresh?: boolean;
  cachedOnly?: boolean;
  now?: Date;
} = {}): Promise<SchedulePayload> {
  if (options.forceRefresh) return refreshSchedule({ force: true, now: options.now });

  const now = options.now ?? new Date();
  const token = process.env.PANDASCORE_TOKEN?.trim();
  const { snapshots, states, refreshInProgress } = await readScheduleParts(now);
  const cachedPanda = aggregatePandaScoreSnapshots(snapshots);

  if (cachedPanda) {
    const games = deriveGameCoverage(snapshots, states, now, refreshInProgress);
    const stale = pandaGameKeys.some((game) => games[game].syncStatus !== "normal");
    return buildPayload(
      cachedPanda,
      states,
      token ? "live" : "unavailable",
      token ? (stale ? "stale-cache" : "connected") : "not-configured",
      now,
      refreshInProgress,
      !token
        ? "生产数据源配置错误；当前响应仅保留上一次成功同步的真实数据。"
        : stale
          ? refreshInProgress
            ? "数据快照已过期，后台同步正在进行；当前快速返回上一次成功的真实数据。"
            : "一个或多个项目的数据同步延迟，当前继续提供各项目上一次成功的真实数据。"
          : undefined,
    );
  }

  return buildPayload(
    null,
    states,
    "unavailable",
    token ? "error" : "not-configured",
    now,
    refreshInProgress,
    token
      ? refreshInProgress ? "首批真实赛程正在后台同步，请稍后重试。" : "尚未生成首批真实数据缓存。"
      : "生产数据源配置错误，暂时没有可用的真实赛程。",
  );
}

export async function refreshSchedule(options: { force?: boolean; now?: Date } = {}): Promise<SchedulePayload> {
  const now = options.now ?? new Date();
  const token = process.env.PANDASCORE_TOKEN?.trim();
  if (!token) return getSchedule({ cachedOnly: true, now });

  const { snapshots, states } = await readScheduleParts(now);
  if (!options.force && allGamesFresh(snapshots, states, now)) {
    return getSchedule({ cachedOnly: true, now });
  }

  const result = await synchronize(token, snapshots, states, now);
  const payload = await getSchedule({ cachedOnly: true, now });
  if (!result.batch) return payload;
  const warning = failureWarning(result.batch);
  return warning ? { ...payload, warning } : payload;
}

export function shouldRefreshSchedule(payload: SchedulePayload): boolean {
  return payload.stale
    && !payload.coverage.refreshInProgress
    && payload.providers.pandascore !== "not-configured";
}

export type {
  DataCoverage,
  EsportsMatch,
  GameKey,
  MatchStatus,
  PandaGameKey,
  SchedulePayload,
} from "./types";
