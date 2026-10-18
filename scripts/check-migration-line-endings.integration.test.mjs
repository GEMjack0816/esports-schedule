import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const checkerPath = fileURLToPath(new URL("./check-migration-line-endings.mjs", import.meta.url));
let fixtureDirectory;

function createFixture(migrationContents) {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "migration-line-ending-check-"));
  mkdirSync(join(fixtureDirectory, "drizzle"), { recursive: true });
  writeFileSync(join(fixtureDirectory, ".gitattributes"), "drizzle/** text eol=lf\n");
  writeFileSync(join(fixtureDirectory, "drizzle", "0007_generated.sql"), migrationContents);

  const init = spawnSync("git", ["init", "--quiet"], {
    cwd: fixtureDirectory,
    encoding: "utf8",
  });
  if (init.error || init.status !== 0) {
    throw init.error ?? new Error(init.stderr || "Unable to initialize temporary Git fixture");
  }

  return spawnSync(process.execPath, [checkerPath], {
    cwd: fixtureDirectory,
    encoding: "utf8",
  });
}

afterEach(() => {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = undefined;
});

describe("migration line-ending checker", () => {
  it("rejects a generated CRLF migration before it is added to Git", () => {
    const result = createFixture(Buffer.from("CREATE TABLE generated (id integer);\r\n"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Carriage return bytes found in Drizzle files:");
    expect(result.stderr).toContain("drizzle/0007_generated.sql");
  });

  it("accepts an untracked generated migration with LF endings", () => {
    const result = createFixture(Buffer.from("CREATE TABLE generated (id integer);\n"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Verified LF line endings in 1 Drizzle files.");
  });
});
