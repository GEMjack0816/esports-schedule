import { getCache } from "@vercel/functions";
import type { PandaGameSnapshot } from "./pandascore";
import { normalizePandaGameSnapshot } from "./snapshot";
import type { PandaGameKey } from "./types";
import { pandaGameKeys } from "./types";

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SYNC_LOCK_TTL_SECONDS = 6 * 60;
const SYNC_LOCK_BASE_KEY = "pandascore-sync-lock-v1";

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

export function runtimeCacheScope(
  environment = process.env.VERCEL_ENV,
  gitRef = process.env.VERCEL_GIT_COMMIT_REF,
  gitSha = process.env.VERCEL_GIT_COMMIT_SHA,
): string {
  // Preserve the existing Production keys during rollout. Preview deployments
  // share a cache target, so branch-scoping prevents one PR from reading another
  // PR's fixtures or lock state.
  if (environment === "production") return "";
  if (environment === "preview") return `preview:${gitRef?.trim() || gitSha?.trim() || "unknown"}:`;
  return `${environment?.trim() || "local"}:`;
}

function scopedKey(key: string): string {
  return `${runtimeCacheScope()}${key}`;
}

function syncLockKey(): string {
  return scopedKey(SYNC_LOCK_BASE_KEY);
}

function snapshotKey(game: PandaGameKey): string {
  return scopedKey(`last-success-v4:${game}`);
}

function syncStateKey(game: PandaGameKey): string {
  return scopedKey(`sync-state-v4:${game}`);
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
  const lockKey = syncLockKey();
  try {
    const existing = await cache.get(lockKey);
    if (isActiveSyncLock(existing, now)) return null;

    const owner = crypto.randomUUID();
    const lock: SyncLock = {
      owner,
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SYNC_LOCK_TTL_SECONDS * 1_000).toISOString(),
    };
    await cache.set(lockKey, lock, {
      name: "PandaScore regional sync lock",
      tags: ["pandascore-sync-lock"],
      ttl: SYNC_LOCK_TTL_SECONDS,
    });

    // A brief claim-confirmation step prevents concurrent regional instances from
    // both proceeding when they observed an expired lock at the same instant.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const confirmed = await cache.get(lockKey);
    return isActiveSyncLock(confirmed, now) && confirmed.owner === owner ? owner : null;
  } catch {
    console.warn("[schedule-cache] regional sync lock unavailable; using instance lock only");
    return "instance-lock-fallback";
  }
}

export async function readPandaScoreSyncLockStatus(now = new Date()): Promise<PandaScoreSyncLockStatus> {
  try {
    const value = await scheduleCache().get(syncLockKey());
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
  const lockKey = syncLockKey();
  try {
    const current = await cache.get(lockKey);
    if (current && typeof current === "object" && (current as Partial<SyncLock>).owner === owner) {
      await cache.delete(lockKey);
    }
  } catch {
    console.warn("[schedule-cache] regional sync lock release failed; TTL will expire it");
  }
}

export async function readPandaScoreGameSnapshot(game: PandaGameKey): Promise<PandaGameSnapshot | null> {
  try {
    const cached = await scheduleCache().get(snapshotKey(game));
    return normalizePandaGameSnapshot(cached, game);
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
