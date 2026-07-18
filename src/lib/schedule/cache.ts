import { getCache } from "@vercel/functions";
import type { PandaScoreResult } from "./pandascore";

const CACHE_KEY = "last-success-v3";
const SYNC_STATE_KEY = "sync-state-v3";
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

export type PandaScoreSyncState = {
  lastAttemptAt: string;
  lastErrorAt: string | null;
};

function scheduleCache() {
  return getCache({ namespace: "esports-schedule" });
}

function isPandaScoreResult(value: unknown): value is PandaScoreResult {
  if (!value || typeof value !== "object") return false;
  const cached = value as Partial<PandaScoreResult>;
  return (
    Array.isArray(cached.matches) &&
    typeof cached.fetchedAt === "string" &&
    !!cached.games &&
    !!cached.totals
  );
}

export async function readLastSuccessfulPandaScore(): Promise<PandaScoreResult | null> {
  try {
    const cached = await scheduleCache().get(CACHE_KEY);
    return isPandaScoreResult(cached) ? cached : null;
  } catch {
    console.warn("[schedule-cache] Last-success cache could not be read");
    return null;
  }
}

export async function writeLastSuccessfulPandaScore(value: PandaScoreResult): Promise<void> {
  try {
    await scheduleCache().set(CACHE_KEY, value, {
      name: "PandaScore last successful fixtures",
      tags: ["pandascore-fixtures", "schedule-last-success"],
      ttl: CACHE_TTL_SECONDS,
    });
  } catch {
    console.warn("[schedule-cache] Last-success cache could not be written");
  }
}

export async function readPandaScoreSyncState(): Promise<PandaScoreSyncState | null> {
  try {
    const value = await scheduleCache().get(SYNC_STATE_KEY);
    if (!value || typeof value !== "object") return null;
    const state = value as Partial<PandaScoreSyncState>;
    return typeof state.lastAttemptAt === "string"
      ? { lastAttemptAt: state.lastAttemptAt, lastErrorAt: state.lastErrorAt ?? null }
      : null;
  } catch {
    console.warn("[schedule-cache] Sync state could not be read");
    return null;
  }
}

export async function writePandaScoreSyncState(value: PandaScoreSyncState): Promise<void> {
  try {
    await scheduleCache().set(SYNC_STATE_KEY, value, {
      name: "PandaScore sync state",
      tags: ["pandascore-fixtures"],
      ttl: CACHE_TTL_SECONDS,
    });
  } catch {
    console.warn("[schedule-cache] Sync state could not be written");
  }
}
