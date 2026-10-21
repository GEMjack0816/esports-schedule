import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Bound SQL work well below the Vercel sync route's 5-minute execution limit.
// Short lock waits let callers fail into the existing stale-snapshot fallback
// instead of occupying a function while another transaction owns a row lock.
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;
const DATABASE_LOCK_TIMEOUT_MS = 5_000;
const DATABASE_IDLE_TRANSACTION_TIMEOUT_MS = 30_000;

let database: PostgresJsDatabase<typeof schema> | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDatabase(): PostgresJsDatabase<typeof schema> {
  if (database) return database;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_NOT_CONFIGURED");

  const client = postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 5,
    connection: {
      statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
      lock_timeout: DATABASE_LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout: DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
    },
    prepare: false,
  });
  database = drizzle({ client, schema });
  return database;
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
