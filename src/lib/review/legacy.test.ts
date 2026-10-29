import { describe, expect, it, vi } from "vitest";
import type { DrizzleReviewRepository } from "./repository";
import type { LegacyImportInputCounts, LegacySubmissionRecord } from "./types";

const cacheState = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  failures: new Set<string>(),
  delete: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({
  getCache: () => ({
    get: async (key: string) => {
      if (cacheState.failures.has(key)) throw new Error("cache unavailable");
      return cacheState.values.get(key);
    },
    delete: cacheState.delete,
  }),
}));

import { importLegacyRuntimeSubmissions } from "./legacy";

describe("legacy Runtime Cache submission migration", () => {
  it("validates legacy records and delegates one atomic import with ids and timestamps", async () => {
    const importedId = "11111111-1111-4111-8111-111111111111";
    const duplicateId = "22222222-2222-4222-8222-222222222222";
    cacheState.values.clear();
    cacheState.failures.clear();
    cacheState.delete.mockReset();
    cacheState.values.set("pending-index-v1", [importedId, duplicateId, "bad-id", importedId]);
    for (const id of [importedId, duplicateId]) {
      cacheState.values.set(`pending:${id}`, {
        game: "lol",
        league: `Legacy ${id}`,
        teamA: "Alpha",
        teamB: "Beta",
        scheduledAt: "2026-08-01T00:00:00.000Z",
        bestOf: 3,
        sourceUrl: "https://example.com/legacy",
        notes: null,
        submittedAt: "2026-07-01T00:00:00.000Z",
      });
    }
    const importLegacySubmissions = vi.fn(async (
      _actor: string,
      records: LegacySubmissionRecord[],
      counts: LegacyImportInputCounts,
    ) => {
      expect(records.map((record) => record.id)).toEqual([importedId, duplicateId]);
      expect(records.map((record) => record.submittedAt.toISOString())).toEqual([
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      ]);
      expect(counts).toEqual({ scanned: 3, invalid: 1 });
      return { ...counts, imported: 1, duplicate: 1 };
    });
    const repository = {
      importLegacySubmissions,
    } as unknown as DrizzleReviewRepository;

    const counts = await importLegacyRuntimeSubmissions("admin-user", repository);

    expect(counts).toEqual({ scanned: 3, imported: 1, duplicate: 1, invalid: 1 });
    expect(importLegacySubmissions).toHaveBeenCalledTimes(1);
    expect(importLegacySubmissions).toHaveBeenCalledWith("admin-user", expect.any(Array), {
      scanned: 3,
      invalid: 1,
    });
    expect(cacheState.delete).not.toHaveBeenCalled();
  });

  it("does not record a partial import when reading the legacy cache fails", async () => {
    cacheState.values.clear();
    cacheState.failures.clear();
    const id = "33333333-3333-4333-8333-333333333333";
    cacheState.values.set("pending-index-v1", [id]);
    cacheState.failures.add(`pending:${id}`);
    const importLegacySubmissions = vi.fn();
    const repository = { importLegacySubmissions } as unknown as DrizzleReviewRepository;

    await expect(importLegacyRuntimeSubmissions("admin-user", repository)).rejects.toThrow(
      "cache unavailable",
    );
    expect(importLegacySubmissions).not.toHaveBeenCalled();
  });

  it("counts non-string index entries as invalid instead of silently dropping them", async () => {
    cacheState.values.clear();
    cacheState.failures.clear();
    const validId = "44444444-4444-4444-8444-444444444444";
    cacheState.values.set("pending-index-v1", [validId, 17, null, validId]);
    cacheState.values.set(`pending:${validId}`, {
      game: "lol",
      league: "Legacy match",
      teamA: "Alpha",
      teamB: "Beta",
      scheduledAt: "2026-08-01T00:00:00.000Z",
      bestOf: 3,
      sourceUrl: "https://example.com/legacy",
      notes: null,
      submittedAt: "2026-07-01T00:00:00.000Z",
    });
    const importLegacySubmissions = vi.fn(async (
      _actor: string,
      records: LegacySubmissionRecord[],
      counts: LegacyImportInputCounts,
    ) => {
      expect(records).toHaveLength(1);
      expect(counts).toEqual({ scanned: 3, invalid: 2 });
      return { ...counts, imported: 1, duplicate: 0 };
    });
    const repository = { importLegacySubmissions } as unknown as DrizzleReviewRepository;

    await expect(importLegacyRuntimeSubmissions("admin-user", repository)).resolves.toEqual({
      scanned: 3,
      invalid: 2,
      imported: 1,
      duplicate: 0,
    });
  });

  it("aborts before database mutation when the legacy index is not an array", async () => {
    cacheState.values.clear();
    cacheState.failures.clear();
    cacheState.values.set("pending-index-v1", { corrupted: true });
    const importLegacySubmissions = vi.fn();
    const repository = { importLegacySubmissions } as unknown as DrizzleReviewRepository;

    await expect(importLegacyRuntimeSubmissions("admin-user", repository)).rejects.toThrow(
      "invalid legacy submission index",
    );
    expect(importLegacySubmissions).not.toHaveBeenCalled();
  });
});
