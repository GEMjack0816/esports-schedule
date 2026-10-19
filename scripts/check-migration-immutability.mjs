import { spawnSync } from "node:child_process";
import { findChangedExistingMigrations } from "./migration-immutability-core.mjs";

const baseRef = process.env.MIGRATION_DIFF_BASE ||
  `origin/${process.env.GITHUB_BASE_REF || "main"}`;
const diff = spawnSync(
  "git",
  ["diff", "--name-status", "--no-renames", `${baseRef}...HEAD`, "--", "drizzle"],
  { encoding: "utf8" },
);

if (diff.error || diff.status !== 0) {
  console.error(`Unable to compare Drizzle migrations with ${baseRef}.`);
  process.exit(1);
}

const changedMigrations = findChangedExistingMigrations(diff.stdout);
if (changedMigrations.length > 0) {
  console.error("Existing Drizzle migrations must not be modified or deleted:");
  for (const migration of changedMigrations) {
    console.error(`- ${migration.status} ${migration.path}`);
  }
  process.exit(1);
}

console.log(`Verified existing Drizzle migrations are unchanged from ${baseRef}.`);
