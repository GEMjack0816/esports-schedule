import { describe, expect, it, vi } from "vitest";
import type { DrizzleReviewRepository } from "./repository";
import type { MatchSubmissionInput } from "@/lib/submissions";

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
  it("preserves valid ids and timestamps and delegates one atomic import without deleting cache", async () => {
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
      records: Array<{ id: string; input: MatchSubmissionInput; submittedAt: Date }>,
      scanned: number,
      invalid: number,
    ) => {
      expect(records.map(({ id }) => id)).toEqual([importedId, duplicateId]);
      expect(records.every(({ submittedAt }) =>
        submittedAt.toISOString() === "2026-07-01T00:00:00.000Z")).toBe(true);
      return { scanned, imported: 1, duplicate: 1, invalid };
    });
    const repository = {
      importLegacySubmissions,
    } as unknown as DrizzleReviewRepository;

    const counts = await importLegacyRuntimeSubmissions("admin-user", repository);

    expect(counts).toEqual({ scanned: 3, imported: 1, duplicate: 1, invalid: 1 });
    expect(importLegacySubmissions).toHaveBeenCalledTimes(1);
    expect(importLegacySubmissions).toHaveBeenCalledWith(
      "admin-user",
      expect.arrayContaining([
        expect.objectContaining({ id: importedId }),
        expect.objectContaining({ id: duplicateId }),
      ]),
      3,
      1,
    );
    expect(cacheState.delete).not.toHaveBeenCalled();
  });
});
