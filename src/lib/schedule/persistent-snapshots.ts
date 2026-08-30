import "server-only";

import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { getDatabase, isDatabaseConfigured, safeDatabaseErrorCode } from "@/db";
import { pandaScoreGameSnapshots } from "@/db/schema";
import type { PandaScoreGameSyncState } from "./cache";
import type { PandaGameSnapshot } from "./pandascore";
import { normalizePandaGameSnapshot } from "./snapshot";
import type { PandaGameKey } from "./types";
import { pandaGameKeys } from "./types";

export type PersistentSnapshotRead = {
  snapshots: Partial<Record<PandaGameKey, PandaGameSnapshot>>;
  states: Partial<Record<PandaGameKey, PandaScoreGameSyncState>>;
  databaseAvailable: boolean;
  errorCode: string | null;
};

export type PersistentSnapshotWriteResult = "written" | "superseded" | "unavailable";

function stateFromRow(row: typeof pandaScoreGameSnapshots.$inferSelect): PandaScoreGameSyncState {
  return {
    game: row.game as PandaGameKey,
    lastAttemptAt: row.lastAttemptAt.toISOString(),
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt.toISOString(),
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastHttpStatus: row.lastHttpStatus,
  };
}

export async function readPersistentPandaScoreSnapshots(
  games: readonly PandaGameKey[] = pandaGameKeys,
): Promise<PersistentSnapshotRead> {
  if (!isDatabaseConfigured() || games.length === 0) {
    return { snapshots: {}, states: {}, databaseAvailable: false, errorCode: "NOT_CONFIGURED" };
  }

  try {
    const rows = await getDatabase()
      .select()
      .from(pandaScoreGameSnapshots)
      .where(inArray(pandaScoreGameSnapshots.game, [...games]));
    const snapshots: Partial<Record<PandaGameKey, PandaGameSnapshot>> = {};
    const states: Partial<Record<PandaGameKey, PandaScoreGameSyncState>> = {};
    for (const row of rows) {
      if (!pandaGameKeys.includes(row.game as PandaGameKey)) continue;
      const game = row.game as PandaGameKey;
      const snapshot = normalizePandaGameSnapshot(row.snapshotPayload, game);
      if (!snapshot || snapshot.fetchedAt !== row.sourceFetchedAt.toISOString()) {
        console.warn(`[schedule-db] ${game} persistent snapshot is invalid`);
        continue;
      }
      snapshots[game] = snapshot;
      states[game] = stateFromRow(row);
    }
    return { snapshots, states, databaseAvailable: true, errorCode: null };
  } catch (error) {
    const errorCode = safeDatabaseErrorCode(error);
    console.warn(`[schedule-db] persistent snapshots unavailable (${errorCode})`);
    return { snapshots: {}, states: {}, databaseAvailable: false, errorCode };
  }
}

export async function writePersistentPandaScoreSnapshot(
  snapshot: PandaGameSnapshot,
  state: PandaScoreGameSyncState,
  generation = crypto.randomUUID(),
): Promise<PersistentSnapshotWriteResult> {
  if (!isDatabaseConfigured()) return "unavailable";
  const normalized = normalizePandaGameSnapshot(snapshot, snapshot.game);
  if (!normalized) return "unavailable";

  const sourceFetchedAt = new Date(normalized.fetchedAt);
  const lastSuccessfulSyncAt = new Date(state.lastSuccessfulSyncAt ?? normalized.fetchedAt);
  const lastAttemptAt = new Date(state.lastAttemptAt);
  try {
    const written = await getDatabase()
      .insert(pandaScoreGameSnapshots)
      .values({
        game: normalized.game,
        snapshotPayload: normalized,
        sourceFetchedAt,
        lastSuccessfulSyncAt,
        lastAttemptAt,
        lastErrorAt: state.lastErrorAt ? new Date(state.lastErrorAt) : null,
        lastErrorCode: state.lastErrorCode,
        lastHttpStatus: state.lastHttpStatus,
        generation,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pandaScoreGameSnapshots.game,
        set: {
          snapshotPayload: normalized,
          sourceFetchedAt,
          lastSuccessfulSyncAt,
          lastAttemptAt,
          lastErrorAt: state.lastErrorAt ? new Date(state.lastErrorAt) : null,
          lastErrorCode: state.lastErrorCode,
          lastHttpStatus: state.lastHttpStatus,
          generation,
          updatedAt: new Date(),
        },
        setWhere: lt(pandaScoreGameSnapshots.sourceFetchedAt, sourceFetchedAt),
      })
      .returning({ game: pandaScoreGameSnapshots.game });
    return written.length === 1 ? "written" : "superseded";
  } catch (error) {
    console.warn(`[schedule-db] ${snapshot.game} persistent snapshot write failed (${safeDatabaseErrorCode(error)})`);
    return "unavailable";
  }
}

export async function recordPersistentPandaScoreFailure(
  state: PandaScoreGameSyncState,
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const attemptAt = new Date(state.lastAttemptAt);
  try {
    const updated = await getDatabase()
      .update(pandaScoreGameSnapshots)
      .set({
        lastAttemptAt: attemptAt,
        lastErrorAt: state.lastErrorAt ? new Date(state.lastErrorAt) : attemptAt,
        lastErrorCode: state.lastErrorCode,
        lastHttpStatus: state.lastHttpStatus,
        updatedAt: new Date(),
      })
      .where(and(
        eq(pandaScoreGameSnapshots.game, state.game),
        lte(pandaScoreGameSnapshots.lastSuccessfulSyncAt, attemptAt),
        lte(pandaScoreGameSnapshots.lastAttemptAt, attemptAt),
      ))
      .returning({ game: pandaScoreGameSnapshots.game });
    return updated.length === 1;
  } catch (error) {
    console.warn(`[schedule-db] ${state.game} sync failure metadata write failed (${safeDatabaseErrorCode(error)})`);
    return false;
  }
}
