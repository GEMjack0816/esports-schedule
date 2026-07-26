import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: databaseUrl ? { url: databaseUrl } : undefined,
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  strict: true,
  verbose: false,
});
