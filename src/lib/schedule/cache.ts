import { getCache } from "@vercel/functions";
import type { PandaGameSnapshot } from "./pandascore";
import { normalizeStoredMatchStatus } from "./status";
import type { MatchStatus, PandaGameKey } from "./types";
import { pandaGameKeys } from "./types";

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SYNC_LOCK_TTL_SECONDS = 6 * 60;
const SYNC_LOCK_KEY = "pandascore-sync-lock-v1";

export type PandaScoreGameSyncState = {
  game: PandaGameKey;
  lastAttemptAt: string;
  lastSuccessfulSyncAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastHttpStatus: number | null;
};

function scheduleCache() {
  return getCache({ namespace: "esports-schedule" });
}

function snapshotKey(game: PandaGameKey): string {
  return `last-success-v4:${game}`;
}

function syncStateKey(game: PandaGameKey): string {
  return `sync-state-v4:${game}`;
}

type SyncLock = {
  owner: string;
  startedAt: string;
  expiresAt: string;
};

export type PandaScoreSyncLockStatus = {
  refreshInProgress: boolean;
  startedAt: string | null;
  expiresAt: string | null;
};

function isActiveSyncLock(value: unknown, now: Date): value is SyncLock {
  if (!value || typeof value !== "object") return false;
  const lock = value as Partial<SyncLock>;
  return typeof lock.owner === "string"
    && typeof lock.expiresAt === "string"
    && Date.parse(lock.expiresAt) > now.getTime();
}

export async function acquirePandaScoreSyncLock(now = new Date()): Promise<string | null> {
  const cache = scheduleCache();
  try {
    const existing = await cache.get(SYNC_LOCK_KEY);
    if (isActiveSyncLock(existing, now)) return null;

    const owner = crypto.randomUUID();
    const lock: SyncLock = {
      owner,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SYNC_LOCK_TTL_SECONDS * 1_000).toISOString(),
    };
    await cache.set(SYNC_LOCK_KEY, lock, {
      name: "PandaScore regional sync lock",
      tags: ["pandascore-sync-lock"],
      ttl: SYNC_LOCK_TTL_SECONDS,
    });

    // A brief claim-confirmation step prevents concurrent regional instances from
    // both proceeding when they observed an expired lock at the same instant.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const confirmed = await cache.get(SYNC_LOCK_KEY);
    return isActiveSyncLock(confirmed, now) && confirmed.owner === owner ? owner : null;
  } catch {
    console.warn("[schedule-cache] regional sync lock unavailable; using instance lock only");
    return "instance-lock-fallback";
  }
}

export async function readPandaScoreSyncLockStatus(now = new Date()): Promise<PandaScoreSyncLockStatus> {
  try {
    const value = await scheduleCache().get(SYNC_LOCK_KEY);
    if (!isActiveSyncLock(value, now)) {
      return { refreshInProgress: false, startedAt: null, expiresAt: null };
    }
    const lock = value as SyncLock;
    return {
      refreshInProgress: true,
      startedAt: typeof lock.startedAt === "string" ? lock.startedAt : null,
      expiresAt: lock.expiresAt,
    };
  } catch {
    console.warn("[schedule-cache] regional sync lock status could not be read");
    return { refreshInProgress: false, startedAt: null, expiresAt: null };
  }
}

export async function releasePandaScoreSyncLock(owner: string): Promise<void> {
  if (owner === "instance-lock-fallback") return;
  const cache = scheduleCache();
  try {
    const current = await cache.get(SYNC_LOCK_KEY);
    if (current && typeof current === "object" && (current as Partial<SyncLock>).owner === owner) {
      await cache.delete(SYNC_LOCK_KEY);
    }
  } catch {
    console.warn("[schedule-cache] regional sync lock release failed; TTL will expire it");
  }
}

function isPandaGameSnapshot(value: unknown, game: PandaGameKey): value is PandaGameSnapshot {
  if (!value || typeof value !== "object") return false;
  const cached = value as Partial<PandaGameSnapshot>;
  return cached.game === game
    && Array.isArray(cached.matches)
    && typeof cached.fetchedAt === "string"
    && !!cached.coverage;
}

function migrateSnapshot(snapshot: PandaGameSnapshot): PandaGameSnapshot {
  const matches = snapshot.matches.map((match) => ({
    ...match,
    status: normalizeStoredMatchStatus(match.status) ?? "unknown",
  }));
  const statusCounts: Record<MatchStatus, number> = {
    scheduled: 0,
    running: 0,
    finished: 0,
    postponed: 0,
    cancelled: 0,
    forfeit: 0,
    unknown: 0,
  };
  for (const match of matches) statusCounts[match.status] += 1;
  return {
    ...snapshot,
    matches,
    coverage: {
      ...snapshot.coverage,
      statusCounts,
    },
  };
}

export async function readPandaScoreGameSnapshot(game: PandaGameKey): Promise<PandaGameSnapshot | null> {
  try {
    const cached = await scheduleCache().get(snapshotKey(game));
    return isPandaGameSnapshot(cached, game) ? migrateSnapshot(cached) : null;
  } catch {
    console.warn(`[schedule-cache] ${game} last-success cache could not be read`);
    return null;
  }
}

export async function readAllPandaScoreGameSnapshots(): Promise<Partial<Record<PandaGameKey, PandaGameSnapshot>>> {
  const settled = await Promise.allSettled(pandaGameKeys.map((game) => readPandaScoreGameSnapshot(game)));
  const snapshots: Partial<Record<PandaGameKey, PandaGameSnapshot>> = {};
  settled.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) snapshots[pandaGameKeys[index]] = result.value;
  });
  return snapshots;
}

export async function writePandaScoreGameSnapshot(value: PandaGameSnapshot): Promise<boolean> {
  try {
    await scheduleCache().set(snapshotKey(value.game), value, {
      name: `PandaScore ${value.game} last successful fixtures`,
      tags: ["pandascore-fixtures", `schedule-${value.game}`],
      ttl: CACHE_TTL_SECONDS,
    });
    return true;
  } catch {
    console.warn(`[schedule-cache] ${value.game} last-success cache could not be written`);
    return false;
  }
}

export async function readPandaScoreGameSyncState(game: PandaGameKey): Promise<PandaScoreGameSyncState | null> {
  try {
    const value = await scheduleCache().get(syncStateKey(game));
    if (!value || typeof value !== "object") return null;
    const state = value as Partial<PandaScoreGameSyncState>;
    return state.game === game && typeof state.lastAttemptAt === "string"
      ? {
          game,
          lastAttemptAt: state.lastAttemptAt,
          lastSuccessfulSyncAt: state.lastSuccessfulSyncAt ?? null,
          lastErrorAt: state.lastErrorAt ?? null,
          lastErrorCode: state.lastErrorCode ?? null,
          lastHttpStatus: state.lastHttpStatus ?? null,
        }
      : null;
  } catch {
    console.warn(`[schedule-cache] ${game} sync state could not be read`);
    return null;
  }
}

export async function readAllPandaScoreGameSyncStates(): Promise<Partial<Record<PandaGameKey, PandaScoreGameSyncState>>> {
  const settled = await Promise.allSettled(pandaGameKeys.map((game) => readPandaScoreGameSyncState(game)));
  const states: Partial<Record<PandaGameKey, PandaScoreGameSyncState>> = {};
  settled.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) states[pandaGameKeys[index]] = result.value;
  });
  return states;
}

export async function writePandaScoreGameSyncState(value: PandaScoreGameSyncState): Promise<boolean> {
  try {
    await scheduleCache().set(syncStateKey(value.game), value, {
      name: `PandaScore ${value.game} sync state`,
      tags: ["pandascore-fixtures", `schedule-${value.game}`],
      ttl: CACHE_TTL_SECONDS,
    });
    return true;
  } catch {
    console.warn(`[schedule-cache] ${value.game} sync state could not be written`);
    return false;
  }
}
