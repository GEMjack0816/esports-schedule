import "server-only";

import { and, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { isDatabaseConfigured, safeDatabaseErrorCode, withDatabaseTimeouts } from "@/db";
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

export type PersistentSnapshotGenerationRead = {
  generations: Partial<Record<PandaGameKey, number>>;
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

function isValidGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export async function allocatePandaScoreSyncGeneration(): Promise<number | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const rows = await withDatabaseTimeouts((tx) => tx.execute<{ generation: string | number }>(
      sql`select nextval('pandascore_sync_generation_seq') as generation`,
    ));
    const generation = Number(rows[0]?.generation);
    return isValidGeneration(generation) ? generation : null;
  } catch (error) {
    console.warn(`[schedule-db] sync generation allocation failed (${safeDatabaseErrorCode(error)})`);
    return null;
  }
}

export async function readPersistentPandaScoreSnapshotGenerations(
  games: readonly PandaGameKey[] = pandaGameKeys,
): Promise<PersistentSnapshotGenerationRead> {
  if (!isDatabaseConfigured() || games.length === 0) {
    return { generations: {}, databaseAvailable: false, errorCode: "NOT_CONFIGURED" };
  }
  try {
    const rows = await withDatabaseTimeouts((tx) => tx
      .select({
        game: pandaScoreGameSnapshots.game,
        fencingGeneration: pandaScoreGameSnapshots.fencingGeneration,
      })
      .from(pandaScoreGameSnapshots)
      .where(inArray(pandaScoreGameSnapshots.game, [...games])));
    const generations: Partial<Record<PandaGameKey, number>> = {};
    for (const row of rows) {
      if (!pandaGameKeys.includes(row.game as PandaGameKey)) continue;
      if (!isValidGeneration(row.fencingGeneration)) continue;
      generations[row.game as PandaGameKey] = row.fencingGeneration;
    }
    return { generations, databaseAvailable: true, errorCode: null };
  } catch (error) {
    const errorCode = safeDatabaseErrorCode(error);
    console.warn(`[schedule-db] persistent snapshot generations unavailable (${errorCode})`);
    return { generations: {}, databaseAvailable: false, errorCode };
  }
}

export async function readPersistentPandaScoreSnapshots(
  games: readonly PandaGameKey[] = pandaGameKeys,
): Promise<PersistentSnapshotRead> {
  if (!isDatabaseConfigured() || games.length === 0) {
    return { snapshots: {}, states: {}, databaseAvailable: false, errorCode: "NOT_CONFIGURED" };
  }

  try {
    const rows = await withDatabaseTimeouts((tx) => tx
      .select()
      .from(pandaScoreGameSnapshots)
      .where(inArray(pandaScoreGameSnapshots.game, [...games])));
    const snapshots: Partial<Record<PandaGameKey, PandaGameSnapshot>> = {};
    const states: Partial<Record<PandaGameKey, PandaScoreGameSyncState>> = {};
    for (const row of rows) {
      if (!pandaGameKeys.includes(row.game as PandaGameKey)) continue;
      const game = row.game as PandaGameKey;
      const snapshot = normalizePandaGameSnapshot(row.snapshotPayload, game);
      if (
        !snapshot
        || snapshot.fetchedAt !== row.sourceFetchedAt.toISOString()
        || !isValidGeneration(row.fencingGeneration)
      ) {
        console.warn(`[schedule-db] ${game} persistent snapshot is invalid`);
        continue;
      }
      snapshots[game] = { ...snapshot, syncGeneration: row.fencingGeneration };
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
  fencingGeneration: number,
  writeGenerationId = crypto.randomUUID(),
): Promise<PersistentSnapshotWriteResult> {
  if (!isDatabaseConfigured()) return "unavailable";
  if (!isValidGeneration(fencingGeneration)) return "unavailable";
  const normalized = normalizePandaGameSnapshot(snapshot, snapshot.game);
  if (!normalized) return "unavailable";
  const versionedSnapshot = { ...normalized, syncGeneration: fencingGeneration };

  const sourceFetchedAt = new Date(versionedSnapshot.fetchedAt);
  const lastSuccessfulSyncAt = new Date(state.lastSuccessfulSyncAt ?? versionedSnapshot.fetchedAt);
  const lastAttemptAt = new Date(state.lastAttemptAt);
  try {
    const written = await withDatabaseTimeouts((tx) => tx
      .insert(pandaScoreGameSnapshots)
      .values({
        game: versionedSnapshot.game,
        snapshotPayload: versionedSnapshot,
        sourceFetchedAt,
        lastSuccessfulSyncAt,
        lastAttemptAt,
        lastErrorAt: state.lastErrorAt ? new Date(state.lastErrorAt) : null,
        lastErrorCode: state.lastErrorCode,
        lastHttpStatus: state.lastHttpStatus,
        generation: writeGenerationId,
        fencingGeneration,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pandaScoreGameSnapshots.game,
        set: {
          snapshotPayload: versionedSnapshot,
          sourceFetchedAt,
          lastSuccessfulSyncAt,
          lastAttemptAt,
          lastErrorAt: state.lastErrorAt ? new Date(state.lastErrorAt) : null,
          lastErrorCode: state.lastErrorCode,
          lastHttpStatus: state.lastHttpStatus,
          generation: writeGenerationId,
          fencingGeneration,
          updatedAt: new Date(),
        },
        setWhere: lt(pandaScoreGameSnapshots.fencingGeneration, fencingGeneration),
      })
      .returning({ game: pandaScoreGameSnapshots.game }));
    return written.length === 1 ? "written" : "superseded";
  } catch (error) {
    console.warn(`[schedule-db] ${snapshot.game} persistent snapshot write failed (${safeDatabaseErrorCode(error)})`);
    return "unavailable";
  }
}

export async function recordPersistentPandaScoreFailure(
  state: PandaScoreGameSyncState,
  fencingGeneration: number,
): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  if (!isValidGeneration(fencingGeneration)) return false;
  const attemptAt = new Date(state.lastAttemptAt);
  try {
    const updated = await withDatabaseTimeouts((tx) => tx
      .update(pandaScoreGameSnapshots)
      .set({
        lastAttemptAt: attemptAt,
        lastErrorAt: state.lastErrorAt ? new Date(state.lastErrorAt) : attemptAt,
        lastErrorCode: state.lastErrorCode,
        lastHttpStatus: state.lastHttpStatus,
        fencingGeneration,
        updatedAt: new Date(),
      })
      .where(and(
        eq(pandaScoreGameSnapshots.game, state.game),
        lt(pandaScoreGameSnapshots.fencingGeneration, fencingGeneration),
        lte(pandaScoreGameSnapshots.lastSuccessfulSyncAt, attemptAt),
        lte(pandaScoreGameSnapshots.lastAttemptAt, attemptAt),
      ))
      .returning({ game: pandaScoreGameSnapshots.game }));
    return updated.length === 1;
  } catch (error) {
    console.warn(`[schedule-db] ${state.game} sync failure metadata write failed (${safeDatabaseErrorCode(error)})`);
    return false;
  }
}
