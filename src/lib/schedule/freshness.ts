import type { GameSyncStatus } from "./types";

export const FRESH_FOR_MS = 15 * 60 * 1_000;
export const FAILED_AFTER_MS = 60 * 60 * 1_000;

/** Keep the server payload and the long-lived browser tab on the same thresholds. */
export function gameSyncStatusAt(
  sourceFetchedAt: string | null,
  lastErrorAt: string | null,
  now: number,
): GameSyncStatus {
  const sourceTime = sourceFetchedAt ? Date.parse(sourceFetchedAt) : Number.NaN;
  const errorTime = lastErrorAt ? Date.parse(lastErrorAt) : Number.NaN;
  const snapshotAge = Number.isFinite(sourceTime)
    ? Math.max(0, now - sourceTime)
    : null;
  const failedAttempt = Number.isFinite(errorTime)
    && (snapshotAge === null || errorTime >= sourceTime);

  if (failedAttempt || snapshotAge === null || snapshotAge > FAILED_AFTER_MS) return "failed";
  if (snapshotAge > FRESH_FOR_MS) return "delayed";
  return "normal";
}

