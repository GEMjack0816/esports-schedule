import { describe, expect, it } from "vitest";
import { findChangedExistingMigrations } from "./migration-immutability-core.mjs";

describe("existing Drizzle migration immutability", () => {
  it("allows new additive migration files", () => {
    expect(findChangedExistingMigrations("A\tdrizzle/0007_add_index.sql")).toEqual([]);
  });

  it("rejects modifications to existing migration SQL", () => {
    expect(findChangedExistingMigrations("M\tdrizzle/0003_existing.sql")).toEqual([
      { status: "M", path: "drizzle/0003_existing.sql" },
    ]);
  });

  it("rejects deletion or replacement of existing migrations", () => {
    expect(
      findChangedExistingMigrations(
        "D\tdrizzle/0004_existing.sql\nT\tdrizzle/0005_existing.sql",
      ),
    ).toEqual([
      { status: "D", path: "drizzle/0004_existing.sql" },
      { status: "T", path: "drizzle/0005_existing.sql" },
    ]);
  });

  it("ignores Drizzle journal metadata and unrelated files", () => {
    expect(
      findChangedExistingMigrations(
        "M\tdrizzle/meta/_journal.json\nM\tsrc/db/schema.ts",
      ),
    ).toEqual([]);
  });
});
