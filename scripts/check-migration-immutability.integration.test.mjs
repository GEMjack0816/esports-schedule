import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const checkerPath = fileURLToPath(new URL("./check-migration-immutability.mjs", import.meta.url));
let fixtureDirectory;

function runGit(args) {
  const result = spawnSync("git", args, { cwd: fixtureDirectory, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(result.stderr || "Temporary Git command failed");
  }
  return result;
}

function createRepository() {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "migration-immutability-check-"));
  mkdirSync(join(fixtureDirectory, "drizzle"), { recursive: true });
  runGit(["init", "--quiet"]);
  runGit(["config", "user.name", "Migration Test"]);
  runGit(["config", "user.email", "migration-test@example.invalid"]);
  writeFileSync(join(fixtureDirectory, "drizzle", "0001_initial.sql"), "CREATE TABLE one (id integer);\n");
  runGit(["add", "drizzle/0001_initial.sql"]);
  runGit(["commit", "--quiet", "-m", "base migration"]);
  runGit(["branch", "base"]);
}

function runChecker() {
  return spawnSync(process.execPath, [checkerPath], {
    cwd: fixtureDirectory,
    encoding: "utf8",
    env: { ...process.env, MIGRATION_DIFF_BASE: "base" },
  });
}

afterEach(() => {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = undefined;
});

describe("migration immutability checker", () => {
  it("fails when an existing migration is edited", () => {
    createRepository();
    writeFileSync(join(fixtureDirectory, "drizzle", "0001_initial.sql"), "CREATE TABLE changed (id integer);\n");
    runGit(["add", "drizzle/0001_initial.sql"]);
    runGit(["commit", "--quiet", "-m", "edit applied migration"]);

    const result = runChecker();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("drizzle/0001_initial.sql");
  });

  it("passes when a new additive migration is added", () => {
    createRepository();
    writeFileSync(join(fixtureDirectory, "drizzle", "0002_add_index.sql"), "CREATE INDEX new_index ON one (id);\n");
    runGit(["add", "drizzle/0002_add_index.sql"]);
    runGit(["commit", "--quiet", "-m", "add migration"]);

    const result = runChecker();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("unchanged from base");
  });
});
