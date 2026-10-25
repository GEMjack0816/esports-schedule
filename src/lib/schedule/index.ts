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
import {
  allocatePandaScoreSyncGeneration,
  readPersistentPandaScoreSnapshots,
  readPersistentPandaScoreSnapshotGenerations,
  recordPersistentPandaScoreFailure,
  writePersistentPandaScoreSnapshot,
} from "./persistent-snapshots";
import type {
  PersistentSnapshotGenerationRead,
  PersistentSnapshotRead,
  PersistentSnapshotWriteResult,
} from "./persistent-snapshots";
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
import { getPublishedDatabaseMatches } from "@/lib/review/public-matches";
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
import { uniqueAndSort } from "./utils";

export const FRESH_FOR_MS = 15 * 60 * 1_000;
const FAILED_AFTER_MS = 60 * 60 * 1_000;
const PERSISTENT_RECOVERY_READ_TIMEOUT_MS = 2_500;

type SnapshotMap = Partial<Record<PandaGameKey, PandaGameSnapshot>>;
type SyncStateMap = Partial<Record<PandaGameKey, PandaScoreGameSyncState>>;
type SnapshotSourceMap = Partial<Record<PandaGameKey, "runtime-cache" | "persistent-snapshot">>;
export type ScheduleSyncError = {
  game: PandaGameKey | null;
  code: string;
  httpStatus: number | null;
};
export type ScheduleSyncSummary = {
  status: "success" | "partial" | "failed" | "busy" | "not-configured" | "fresh";
  lockAcquired: boolean;
  generation: number | null;
  gamesAttempted: number;
  gamesSucceeded: number;
  gamesFailed: number;
  snapshotsPersisted: number;
  sourceFetchedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  errors: ScheduleSyncError[];
};
type RefreshResult = {
  batch: PandaScoreSyncBatch | null;
  states: SyncStateMap;
  summary: ScheduleSyncSummary;
};

const refreshSingleFlight = createSingleFlight<RefreshResult>();
const persistentRecoverySingleFlight = createSingleFlight<PersistentSnapshotRead>();
const persistentGenerationSingleFlight = createSingleFlight<PersistentSnapshotGenerationRead>();

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
  snapshotSources: SnapshotSourceMap = {},
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
      dataSource: snapshot
        ? snapshotSources[game] === "persistent-snapshot"
          ? "persistent"
          : syncStatus === "normal" ? "fresh" : "cache"
        : "unavailable",
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
  databaseManualCount: number,
  refreshInProgress: boolean,
  snapshotSources: SnapshotSourceMap,
): DataCoverage {
  const range = bounds(matches);
  const snapshots = panda?.snapshots ?? {};
  const games = deriveGameCoverage(snapshots, states, now, refreshInProgress, snapshotSources);
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
      published: manual.honorOfKingsCount + manual.supplementalCount + databaseManualCount,
      database: databaseManualCount,
    },
  };
}

async function buildPayload(
  panda: PandaScoreResult | null,
  states: SyncStateMap,
  mode: SchedulePayload["mode"],
  provider: SchedulePayload["providers"]["pandascore"],
  now: Date,
  refreshInProgress: boolean,
  snapshotSources: SnapshotSourceMap,
  warning?: string,
  forceStale = false,
): Promise<SchedulePayload> {
  const manual = applyManualData(panda?.matches ?? [], now);
  const databaseManual = await getPublishedDatabaseMatches();
  const matches = uniqueAndSort([...manual.matches, ...databaseManual.matches]);
  const games = deriveGameCoverage(panda?.snapshots ?? {}, states, now, refreshInProgress, snapshotSources);
  const stale = panda
    ? forceStale || pandaGameKeys.some((game) => games[game].syncStatus !== "normal")
    : true;
  const coverage = makeCoverage(
    mode,
    stale,
    now,
    panda,
    states,
    matches,
    manual,
    databaseManual.matches.length,
    refreshInProgress,
    snapshotSources,
  );

  return {
    matches,
    generatedAt: now.toISOString(),
    mode,
    demoMode: false,
    stale,
    lastSuccessfulSyncAt: coverage.lastSuccessfulSyncAt,
    providers: {
      pandascore: provider,
      manual: "json+database",
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

type PersistBatchResult = {
  states: SyncStateMap;
  generation: number;
  gamesSucceeded: number;
  gamesFailed: number;
  snapshotsPersisted: number;
  errors: ScheduleSyncError[];
};

type SnapshotPersistenceEffects = {
  writePersistent: (
    snapshot: PandaGameSnapshot,
    state: PandaScoreGameSyncState,
    fencingGeneration: number,
  ) => Promise<PersistentSnapshotWriteResult>;
  recordFailure: (state: PandaScoreGameSyncState, fencingGeneration: number) => Promise<boolean>;
  writeRuntimeSnapshot: (snapshot: PandaGameSnapshot) => Promise<boolean>;
  writeRuntimeState: (state: PandaScoreGameSyncState) => Promise<boolean>;
};

const defaultSnapshotPersistenceEffects: SnapshotPersistenceEffects = {
  writePersistent: writePersistentPandaScoreSnapshot,
  recordFailure: recordPersistentPandaScoreFailure,
  writeRuntimeSnapshot: writePandaScoreGameSnapshot,
  writeRuntimeState: writePandaScoreGameSyncState,
};

export async function persistPandaScoreSyncBatch(
  batch: PandaScoreSyncBatch,
  attemptedStates: SyncStateMap,
  now: Date,
  fencingGeneration: number,
  effects: SnapshotPersistenceEffects = defaultSnapshotPersistenceEffects,
): Promise<PersistBatchResult> {
  const nextStates: SyncStateMap = { ...attemptedStates };
  const outcomes = await Promise.all(pandaGameKeys.map(async (game) => {
    const snapshot = batch.snapshots[game];
    const failure = batch.failures[game];
    if (batch.updatedGames.includes(game) && snapshot) {
      const versionedSnapshot = { ...snapshot, syncGeneration: fencingGeneration };
      const state = stateAfterSuccess(game, versionedSnapshot, now);
      const persistentResult = await effects.writePersistent(versionedSnapshot, state, fencingGeneration);
      if (persistentResult === "written") {
        nextStates[game] = state;
        const runtimeSnapshotWritten = await effects.writeRuntimeSnapshot(versionedSnapshot);
        await effects.writeRuntimeState(state);
        return {
          succeeded: 1,
          failed: 0,
          persisted: 1,
          errors: runtimeSnapshotWritten
            ? []
            : [{ game, code: "CACHE_WRITE", httpStatus: null } satisfies ScheduleSyncError],
        };
      }
      if (persistentResult === "superseded") {
        return {
          succeeded: 0,
          failed: 1,
          persisted: 0,
          errors: [{ game, code: "SNAPSHOT_SUPERSEDED", httpStatus: null } satisfies ScheduleSyncError],
        };
      }
      const persistenceFailure = stateAfterFailure(
        game,
        attemptedStates[game],
        snapshot,
        { code: "PERSISTENT_WRITE", status: null },
        now,
      );
      nextStates[game] = persistenceFailure;
      await effects.writeRuntimeState(persistenceFailure);
      return {
        succeeded: 0,
        failed: 1,
        persisted: 0,
        errors: [{ game, code: persistenceFailure.lastErrorCode!, httpStatus: null } satisfies ScheduleSyncError],
      };
    }
    if (failure) {
      const state = stateAfterFailure(game, attemptedStates[game], snapshot, failure, now);
      nextStates[game] = state;
      await Promise.allSettled([
        effects.recordFailure(state, fencingGeneration),
        effects.writeRuntimeState(state),
      ]);
      console.error(`[schedule] ${game} sync failed (${failure.code}${failure.status ? ` HTTP ${failure.status}` : ""})`);
      return {
        succeeded: 0,
        failed: 1,
        persisted: 0,
        errors: [{ game, code: failure.code, httpStatus: failure.status } satisfies ScheduleSyncError],
      };
    }
    return {
      succeeded: 0,
      failed: 1,
      persisted: 0,
      errors: [{ game, code: "MISSING_SYNC_OUTCOME", httpStatus: null } satisfies ScheduleSyncError],
    };
  }));
  return {
    states: nextStates,
    generation: fencingGeneration,
    gamesSucceeded: outcomes.reduce((sum, value) => sum + value.succeeded, 0),
    gamesFailed: outcomes.reduce((sum, value) => sum + value.failed, 0),
    snapshotsPersisted: outcomes.reduce((sum, value) => sum + value.persisted, 0),
    errors: outcomes.flatMap((value) => value.errors),
  };
}

async function persistUnexpectedFailure(
  snapshots: SnapshotMap,
  states: SyncStateMap,
  now: Date,
  fencingGeneration: number,
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
    await Promise.allSettled([
      recordPersistentPandaScoreFailure(state, fencingGeneration),
      writePandaScoreGameSyncState(state),
    ]);
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
      return {
        batch: null,
        states: previousStates,
        summary: {
          status: "busy",
          lockAcquired: false,
          generation: null,
          gamesAttempted: 0,
          gamesSucceeded: 0,
          gamesFailed: 0,
          snapshotsPersisted: 0,
          sourceFetchedAt: minDate(pandaGameKeys.map((game) => snapshots[game]?.fetchedAt)),
          lastSuccessfulSyncAt: maxDate(Object.values(previousStates).map((state) => state?.lastSuccessfulSyncAt)),
          errors: [],
        },
      };
    }

    console.info("[schedule] regional refresh lock acquired");
    const fencingGeneration = await allocatePandaScoreSyncGeneration();
    if (fencingGeneration === null) {
      await releasePandaScoreSyncLock(lockOwner);
      return {
        batch: null,
        states: previousStates,
        summary: {
          status: "failed",
          lockAcquired: true,
          generation: null,
          gamesAttempted: 0,
          gamesSucceeded: 0,
          gamesFailed: 0,
          snapshotsPersisted: 0,
          sourceFetchedAt: minDate(pandaGameKeys.map((game) => snapshots[game]?.fetchedAt)),
          lastSuccessfulSyncAt: maxDate(Object.values(previousStates).map((state) => state?.lastSuccessfulSyncAt)),
          errors: [{ game: null, code: "PERSISTENT_GENERATION", httpStatus: null }],
        },
      };
    }
    let states = await markSyncAttemptStarted(snapshots, previousStates, now);
    try {
      const batch = await syncPandaScoreGames(token, snapshots, { now });
      const persisted = await persistPandaScoreSyncBatch(batch, states, now, fencingGeneration);
      states = persisted.states;
      const status = persisted.gamesSucceeded === pandaGameKeys.length && persisted.errors.length === 0
        ? "success"
        : persisted.gamesSucceeded > 0
          ? "partial"
          : "failed";
      return {
        batch,
        states,
        summary: {
          status,
          lockAcquired: true,
          generation: persisted.generation,
          gamesAttempted: pandaGameKeys.length,
          gamesSucceeded: persisted.gamesSucceeded,
          gamesFailed: persisted.gamesFailed,
          snapshotsPersisted: persisted.snapshotsPersisted,
          sourceFetchedAt: minDate(pandaGameKeys.map((game) => batch.snapshots[game]?.fetchedAt)),
          lastSuccessfulSyncAt: maxDate(Object.values(states).map((state) => state?.lastSuccessfulSyncAt)),
          errors: persisted.errors,
        },
      };
    } catch {
      states = await persistUnexpectedFailure(snapshots, states, now, fencingGeneration);
      return {
        batch: null,
        states,
        summary: {
          status: "failed",
          lockAcquired: true,
          generation: fencingGeneration,
          gamesAttempted: pandaGameKeys.length,
          gamesSucceeded: 0,
          gamesFailed: pandaGameKeys.length,
          snapshotsPersisted: 0,
          sourceFetchedAt: minDate(pandaGameKeys.map((game) => snapshots[game]?.fetchedAt)),
          lastSuccessfulSyncAt: maxDate(Object.values(states).map((state) => state?.lastSuccessfulSyncAt)),
          errors: [{ game: null, code: "UNEXPECTED_SYNC_ERROR", httpStatus: null }],
        },
      };
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

type ScheduleRecoveryEffects = {
  readGenerations: (games: readonly PandaGameKey[]) => Promise<PersistentSnapshotGenerationRead>;
  readPersistent: (games: readonly PandaGameKey[]) => Promise<PersistentSnapshotRead>;
  writeRuntimeSnapshot: (snapshot: PandaGameSnapshot) => Promise<boolean>;
  writeRuntimeState: (state: PandaScoreGameSyncState) => Promise<boolean>;
};

const defaultScheduleRecoveryEffects: ScheduleRecoveryEffects = {
  readGenerations: (games) => persistentGenerationSingleFlight.run(
    () => readPersistentPandaScoreSnapshotGenerations(games),
  ),
  readPersistent: (games) => persistentRecoverySingleFlight.run(
    () => readPersistentPandaScoreSnapshots(games),
  ),
  writeRuntimeSnapshot: writePandaScoreGameSnapshot,
  writeRuntimeState: writePandaScoreGameSyncState,
};

async function readPersistentWithDeadline<T>(operation: Promise<T>, unavailable: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    operation,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(unavailable), PERSISTENT_RECOVERY_READ_TIMEOUT_MS);
      timer.unref?.();
    }),
  ]).catch(() => unavailable).finally(() => clearTimeout(timer));
}

export async function recoverScheduleParts(
  runtimeSnapshots: SnapshotMap,
  runtimeStates: SyncStateMap,
  effects: ScheduleRecoveryEffects = defaultScheduleRecoveryEffects,
) {
  const snapshots: SnapshotMap = { ...runtimeSnapshots };
  const states: SyncStateMap = { ...runtimeStates };
  const snapshotSources: SnapshotSourceMap = {};
  for (const game of pandaGameKeys) {
    if (runtimeSnapshots[game]) snapshotSources[game] = "runtime-cache";
  }
  const persistentGenerations = await readPersistentWithDeadline(
    effects.readGenerations(pandaGameKeys),
    { generations: {}, databaseAvailable: false, errorCode: "TIMEOUT" },
  );
  const recoveryGames = pandaGameKeys.filter((game) => {
    const persistentGeneration = persistentGenerations.generations[game];
    const runtimeGeneration = snapshots[game]?.syncGeneration;
    return !snapshots[game]
      || !states[game]
      || (persistentGeneration !== undefined
        && (runtimeGeneration === undefined || persistentGeneration > runtimeGeneration));
  });
  if (recoveryGames.length === 0) {
    return {
      snapshots,
      states,
      snapshotSources,
      recoveredGames: [] as PandaGameKey[],
      persistentStoreAvailable: persistentGenerations.databaseAvailable,
    };
  }

  const persistent = await readPersistentWithDeadline(
    effects.readPersistent(recoveryGames),
    { snapshots: {}, states: {}, databaseAvailable: false, errorCode: "TIMEOUT" },
  );
  const recoveredGames: PandaGameKey[] = [];
  await Promise.allSettled(recoveryGames.map(async (game) => {
    const persistentSnapshot = persistent.snapshots[game];
    const persistentState = persistent.states[game];
    const persistentGeneration = persistentSnapshot?.syncGeneration
      ?? persistentGenerations.generations[game];
    const runtimeGeneration = snapshots[game]?.syncGeneration;
    const persistentIsNewer = !!persistentSnapshot && (
      !snapshots[game]
      || (persistentGeneration !== undefined
        && (runtimeGeneration === undefined || persistentGeneration > runtimeGeneration))
    );
    const generationsMatch = persistentGeneration !== undefined
      && runtimeGeneration !== undefined
      && persistentGeneration === runtimeGeneration;
    if (persistentIsNewer && persistentSnapshot) {
      snapshots[game] = persistentSnapshot;
      snapshotSources[game] = "persistent-snapshot";
      recoveredGames.push(game);
      await effects.writeRuntimeSnapshot(persistentSnapshot);
    }
    if ((persistentIsNewer || (!states[game] && generationsMatch)) && persistentState) {
      states[game] = persistentState;
      await effects.writeRuntimeState(persistentState);
    }
  }));
  return {
    snapshots,
    states,
    snapshotSources,
    recoveredGames,
    persistentStoreAvailable:
      persistentGenerations.databaseAvailable && persistent.databaseAvailable,
  };
}

async function readScheduleParts(now: Date) {
  const reads = await Promise.allSettled([
    readAllPandaScoreGameSnapshots(),
    readAllPandaScoreGameSyncStates(),
    readPandaScoreSyncLockStatus(now),
  ]);
  const recovered = await recoverScheduleParts(
    reads[0].status === "fulfilled" ? reads[0].value : {},
    reads[1].status === "fulfilled" ? reads[1].value : {},
  );
  return {
    ...recovered,
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
  const parts = await readScheduleParts(now);
  return buildScheduleFromParts(parts, token, now);
}

export async function buildScheduleFromParts(
  parts: {
    snapshots: SnapshotMap;
    states: SyncStateMap;
    snapshotSources: SnapshotSourceMap;
    refreshInProgress: boolean;
    persistentStoreAvailable?: boolean;
  },
  token: string | undefined,
  now: Date,
): Promise<SchedulePayload> {
  const {
    snapshots,
    states,
    snapshotSources,
    refreshInProgress,
    persistentStoreAvailable = true,
  } = parts;
  const cachedPanda = aggregatePandaScoreSnapshots(snapshots);

  if (cachedPanda) {
    const games = deriveGameCoverage(snapshots, states, now, refreshInProgress, snapshotSources);
    const persistentStoreDegraded = !persistentStoreAvailable;
    const stale = persistentStoreDegraded
      || pandaGameKeys.some((game) => games[game].syncStatus !== "normal");
    const persistentFallback = pandaGameKeys.some(
      (game) => snapshotSources[game] === "persistent-snapshot",
    );
    return buildPayload(
      cachedPanda,
      states,
      "live",
      token ? (stale ? "stale-cache" : "connected") : "not-configured",
      now,
      refreshInProgress,
      snapshotSources,
      !token
        ? "生产数据源配置错误；当前响应仅保留上一次成功同步的真实数据。"
        : persistentStoreDegraded
          ? "持久快照暂时无法校验；当前保留上一次成功数据并标记为降级状态。"
        : stale
          ? refreshInProgress
            ? "数据快照已过期，后台同步正在进行；当前快速返回上一次成功的真实数据。"
            : "一个或多个项目的数据同步延迟，当前继续提供各项目上一次成功的真实数据。"
          : persistentFallback
            ? "Runtime Cache 未命中，当前数据已从持久化的最后成功快照恢复。"
          : undefined,
      persistentStoreDegraded,
    );
  }

  return buildPayload(
    null,
    states,
    "unavailable",
    token ? "error" : "not-configured",
    now,
    refreshInProgress,
    snapshotSources,
    token
      ? refreshInProgress ? "首批真实赛程正在后台同步，请稍后重试。" : "尚未生成首批真实数据缓存。"
      : "生产数据源配置错误，暂时没有可用的真实赛程。",
  );
}

export async function refreshScheduleDetailed(
  options: { force?: boolean; now?: Date } = {},
): Promise<{ schedule: SchedulePayload; sync: ScheduleSyncSummary }> {
  const now = options.now ?? new Date();
  const token = process.env.PANDASCORE_TOKEN?.trim();
  if (!token) {
    const schedule = await getSchedule({ cachedOnly: true, now });
    return {
      schedule,
      sync: {
        status: "not-configured",
        lockAcquired: false,
        generation: null,
        gamesAttempted: 0,
        gamesSucceeded: 0,
        gamesFailed: 0,
        snapshotsPersisted: 0,
        sourceFetchedAt: schedule.coverage.sourceFetchedAt,
        lastSuccessfulSyncAt: schedule.lastSuccessfulSyncAt,
        errors: [{ game: null, code: "PANDASCORE_NOT_CONFIGURED", httpStatus: null }],
      },
    };
  }

  const { snapshots, states } = await readScheduleParts(now);
  if (!options.force && allGamesFresh(snapshots, states, now)) {
    const schedule = await getSchedule({ cachedOnly: true, now });
    return {
      schedule,
      sync: {
        status: "fresh",
        lockAcquired: false,
        generation: null,
        gamesAttempted: 0,
        gamesSucceeded: 0,
        gamesFailed: 0,
        snapshotsPersisted: 0,
        sourceFetchedAt: schedule.coverage.sourceFetchedAt,
        lastSuccessfulSyncAt: schedule.lastSuccessfulSyncAt,
        errors: [],
      },
    };
  }

  const result = await synchronize(token, snapshots, states, now);
  const payload = await getSchedule({ cachedOnly: true, now });
  const warning = result.batch ? failureWarning(result.batch) : undefined;
  return {
    schedule: warning ? { ...payload, warning } : payload,
    sync: {
      ...result.summary,
      sourceFetchedAt: payload.coverage.sourceFetchedAt,
      lastSuccessfulSyncAt: payload.lastSuccessfulSyncAt,
    },
  };
}

export async function refreshSchedule(options: { force?: boolean; now?: Date } = {}): Promise<SchedulePayload> {
  return (await refreshScheduleDetailed(options)).schedule;
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
