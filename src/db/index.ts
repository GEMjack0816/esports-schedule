import "server-only";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Bound SQL work well below the Vercel sync route's 5-minute execution limit.
// Short lock waits let callers fail into the existing stale-snapshot fallback
// instead of occupying a function while another transaction owns a row lock.
// Do not set idle_in_transaction_session_timeout globally: manual schedule
// mutations can await an external Runtime Cache fence while holding a DB
// transaction. Killing that session first could release the serialization lock
// while the uncancellable cache write is still able to complete out of order.
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;
const DATABASE_LOCK_TIMEOUT_MS = 5_000;

let database: PostgresJsDatabase<typeof schema> | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function createPostgresClientOptions() {
  return {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 5,
    prepare: false,
  } as const;
}

export function getDatabase(): PostgresJsDatabase<typeof schema> {
  if (database) return database;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_NOT_CONFIGURED");

  const client = postgres(url, createPostgresClientOptions());
  database = drizzle({ client, schema });
  return database;
}

type DatabaseTransaction = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];

/**
 * Apply per-transaction limits instead of PostgreSQL startup parameters.
 * Neon transaction-pooler endpoints reject arbitrary startup parameters and
 * only guarantee supported PostgreSQL session variables inside a transaction.
 */
export async function withDatabaseTimeouts<T>(
  operation: (tx: DatabaseTransaction) => Promise<T>,
  timeouts: { statementTimeoutMs?: number; lockTimeoutMs?: number } = {},
): Promise<T> {
  const statementTimeoutMs = timeouts.statementTimeoutMs ?? DATABASE_STATEMENT_TIMEOUT_MS;
  const lockTimeoutMs = timeouts.lockTimeoutMs ?? DATABASE_LOCK_TIMEOUT_MS;
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('statement_timeout', ${`${statementTimeoutMs}ms`}, true),
      set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true)
    `);
    return operation(tx);
  });
}

export function safeDatabaseErrorCode(error: unknown): string {
  if (error instanceof Error && error.message === "DATABASE_NOT_CONFIGURED") {
    return "NOT_CONFIGURED";
  }
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (code === "23505") return "DUPLICATE";
    if (code === "23503") return "FOREIGN_KEY";
    if (code === "23514") return "CONSTRAINT";
    if (code === "57014" || code === "25P03") return "TIMEOUT";
    if (code === "55P03") return "LOCK_TIMEOUT";
  }
  return "UNAVAILABLE";
}
