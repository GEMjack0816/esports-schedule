import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  findChangedExistingMigrations,
  findChangedExistingSnapshots,
  isAppendOnlyMigrationJournal,
} from "./migration-immutability-core.mjs";

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

const changedArtifacts = [
  ...findChangedExistingMigrations(diff.stdout),
  ...findChangedExistingSnapshots(diff.stdout),
];
if (changedArtifacts.length > 0) {
  console.error("Existing Drizzle migrations and snapshots must not be modified or deleted:");
  for (const artifact of changedArtifacts) {
    console.error(`- ${artifact.status} ${artifact.path}`);
  }
  process.exit(1);
}

const baseJournal = spawnSync("git", ["show", `${baseRef}:drizzle/meta/_journal.json`], {
  encoding: "utf8",
});
let currentJournal;
try {
  currentJournal = readFileSync("drizzle/meta/_journal.json", "utf8");
} catch {
  console.error("Unable to read the current Drizzle migration journal.");
  process.exit(1);
}
if (baseJournal.error || baseJournal.status !== 0
  || !isAppendOnlyMigrationJournal(baseJournal.stdout, currentJournal)) {
  console.error("Drizzle migration journal history must remain unchanged; only valid appended entries are allowed.");
  process.exit(1);
}

console.log(`Verified existing Drizzle migrations and journal history are unchanged from ${baseRef}.`);
