import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { containsCarriageReturn } from "./migration-line-endings-core.mjs";

function listGitFiles(args) {
  const result = spawnSync("git", args, { encoding: "buffer" });
  if (result.error || result.status !== 0) return null;
  return result.stdout.toString("utf8").split("\0").filter(Boolean);
}

const trackedFiles = listGitFiles(["ls-files", "-z", "--", "drizzle"]);
const untrackedFiles = listGitFiles([
  "ls-files",
  "--others",
  "--exclude-standard",
  "-z",
  "--",
  "drizzle",
]);

if (!trackedFiles || !untrackedFiles) {
  console.error("Unable to enumerate Drizzle migration files.");
  process.exit(1);
}

// Include generated migrations before `git add`: they can be applied locally
// before entering the index, so checking tracked files alone is too late.
const files = [...new Set([...trackedFiles, ...untrackedFiles])];

if (files.length === 0) {
  console.error("No files found under drizzle/.");
  process.exit(1);
}

const attributes = spawnSync(
  "git",
  ["check-attr", "-z", "--stdin", "text", "eol"],
  { input: Buffer.from(`${files.join("\0")}\0`), encoding: "buffer" },
);

if (attributes.error || attributes.status !== 0) {
  console.error("Unable to verify Git line-ending attributes.");
  process.exit(1);
}

const attributeRecords = attributes.stdout.toString("utf8").split("\0");
const attributesByFile = new Map();
for (let index = 0; index + 2 < attributeRecords.length; index += 3) {
  const [file, attribute, value] = attributeRecords.slice(index, index + 3);
  const values = attributesByFile.get(file) ?? {};
  values[attribute] = value;
  attributesByFile.set(file, values);
}

const filesWithoutLfPolicy = files.filter((file) => {
  const values = attributesByFile.get(file);
  return values?.text !== "set" || values?.eol !== "lf";
});

if (filesWithoutLfPolicy.length > 0) {
  console.error("Git LF attributes are missing for Drizzle files:");
  for (const file of filesWithoutLfPolicy) console.error(`- ${file}`);
  process.exit(1);
}

const filesWithCr = files.filter((file) =>
  containsCarriageReturn(readFileSync(file)),
);

if (filesWithCr.length > 0) {
  console.error("Carriage return bytes found in Drizzle files:");
  for (const file of filesWithCr) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`Verified LF line endings in ${files.length} Drizzle files.`);
