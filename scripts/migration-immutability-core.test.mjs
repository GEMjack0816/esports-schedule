import { describe, expect, it } from "vitest";
import {
  findChangedExistingMigrations,
  findChangedExistingSnapshots,
  isAppendOnlyMigrationJournal,
} from "./migration-immutability-core.mjs";

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

  it("ignores appended snapshots and unrelated files", () => {
    expect(
      findChangedExistingSnapshots(
        "A\tdrizzle/meta/0007_snapshot.json\nM\tsrc/db/schema.ts",
      ),
    ).toEqual([]);
  });

  it("rejects edits and deletions of existing Drizzle snapshots", () => {
    expect(findChangedExistingSnapshots(
      "M\tdrizzle/meta/0004_snapshot.json\nD\tdrizzle/meta/0005_snapshot.json",
    )).toEqual([
      { status: "M", path: "drizzle/meta/0004_snapshot.json" },
      { status: "D", path: "drizzle/meta/0005_snapshot.json" },
    ]);
  });

  it("allows a valid appended journal entry without changing migration history", () => {
    const base = JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: [{ idx: 0, version: "7", tag: "0000_initial", when: 1, breakpoints: true }],
    });
    const current = JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: [
        { idx: 0, version: "7", tag: "0000_initial", when: 1, breakpoints: true },
        { idx: 1, version: "7", tag: "0001_additive", when: 2, breakpoints: true },
      ],
    });
    expect(isAppendOnlyMigrationJournal(base, current)).toBe(true);
  });

  it.each([
    JSON.stringify({ version: "7", dialect: "postgresql", entries: [] }),
    JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", tag: "0000_changed", when: 1, breakpoints: true }] }),
    JSON.stringify({ version: "7", dialect: "sqlite", entries: [{ idx: 0, version: "7", tag: "0000_initial", when: 1, breakpoints: true }] }),
    JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", tag: "0000_initial", when: 1, breakpoints: true }, { idx: 2, version: "7", tag: "0001_gap", when: 2, breakpoints: true }] }),
    JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", tag: "0000_initial", when: 1, breakpoints: true }, { idx: 1, version: "7", tag: "0001_older_timestamp", when: 1, breakpoints: true }] }),
    JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", tag: "0000_initial", when: 1, breakpoints: true }, { idx: 1, version: "7", tag: "0000_initial", when: 2, breakpoints: true }] }),
    JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", tag: "0000_initial", when: 1, breakpoints: true }, { idx: 1, version: "7", tag: "0001_unsafe_timestamp", when: "2", breakpoints: true }] }),
    "not-json",
  ])("rejects modified, truncated, malformed, or invalid journal history", (current) => {
    const base = JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: [{ idx: 0, tag: "0000_initial", when: 1, breakpoints: true }],
    });
    expect(isAppendOnlyMigrationJournal(base, current)).toBe(false);
  });
});
