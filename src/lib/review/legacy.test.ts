import { describe, expect, it, vi } from "vitest";
import type { DrizzleReviewRepository } from "./repository";
import type { LegacyImportSourceCounts, LegacySubmissionImportRecord } from "./types";

const cacheState = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  delete: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({
  getCache: () => ({
    get: async (key: string) => cacheState.values.get(key),
    delete: cacheState.delete,
  }),
}));

import { importLegacyRuntimeSubmissions } from "./legacy";

describe("legacy Runtime Cache submission migration", () => {
  it("preserves ids and timestamps, skips duplicates, audits counts and never deletes cache", async () => {
    const importedId = "11111111-1111-4111-8111-111111111111";
    const duplicateId = "22222222-2222-4222-8222-222222222222";
    cacheState.values.clear();
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
      _actorId: string,
      records: LegacySubmissionImportRecord[],
      sourceCounts: LegacyImportSourceCounts,
    ) => {
      expect(records.every((record) => record.submittedAt.toISOString() === "2026-07-01T00:00:00.000Z")).toBe(true);
      return {
        ...sourceCounts,
        imported: 1,
        duplicate: records.length - 1,
      };
    });
    const repository = {
      importLegacySubmissions,
    } as unknown as DrizzleReviewRepository;

    const counts = await importLegacyRuntimeSubmissions("admin-user", repository);

    expect(counts).toEqual({ scanned: 3, imported: 1, duplicate: 1, invalid: 1 });
    expect(importLegacySubmissions).toHaveBeenCalledTimes(1);
    expect(importLegacySubmissions.mock.calls[0]?.[0]).toBe("admin-user");
    expect(importLegacySubmissions.mock.calls[0]?.[1].map((record) => record.id)).toEqual([
      importedId,
      duplicateId,
    ]);
    expect(importLegacySubmissions.mock.calls[0]?.[2]).toEqual({ scanned: 3, invalid: 1 });
    expect(cacheState.delete).not.toHaveBeenCalled();
  });
});
