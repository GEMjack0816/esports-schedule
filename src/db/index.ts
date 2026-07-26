import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

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
    if (code === "57014") return "TIMEOUT";
  }
  return "UNAVAILABLE";
}
