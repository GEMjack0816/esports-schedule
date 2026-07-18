import { getCache } from "@vercel/functions";
import type { PandaGameSnapshot } from "./pandascore";
import type { PandaGameKey } from "./types";
import { pandaGameKeys } from "./types";

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

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

function isPandaGameSnapshot(value: unknown, game: PandaGameKey): value is PandaGameSnapshot {
  if (!value || typeof value !== "object") return false;
  const cached = value as Partial<PandaGameSnapshot>;
  return cached.game === game
    && Array.isArray(cached.matches)
    && typeof cached.fetchedAt === "string"
    && !!cached.coverage;
}

export async function readPandaScoreGameSnapshot(game: PandaGameKey): Promise<PandaGameSnapshot | null> {
  try {
    const cached = await scheduleCache().get(snapshotKey(game));
    return isPandaGameSnapshot(cached, game) ? cached : null;
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

export async function writePandaScoreGameSnapshot(value: PandaGameSnapshot): Promise<void> {
  try {
    await scheduleCache().set(snapshotKey(value.game), value, {
      name: `PandaScore ${value.game} last successful fixtures`,
      tags: ["pandascore-fixtures", `schedule-${value.game}`],
      ttl: CACHE_TTL_SECONDS,
    });
  } catch {
    console.warn(`[schedule-cache] ${value.game} last-success cache could not be written`);
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

export async function writePandaScoreGameSyncState(value: PandaScoreGameSyncState): Promise<void> {
  try {
    await scheduleCache().set(syncStateKey(value.game), value, {
      name: `PandaScore ${value.game} sync state`,
      tags: ["pandascore-fixtures", `schedule-${value.game}`],
      ttl: CACHE_TTL_SECONDS,
    });
  } catch {
    console.warn(`[schedule-cache] ${value.game} sync state could not be written`);
  }
}
