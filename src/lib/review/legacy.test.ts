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
    const importLegacySubmissionsAtomically = vi.fn(async (
      actorId: string,
      candidates: Array<{ input: MatchSubmissionInput; id: string; submittedAt: Date }>,
      initialCounts: { scanned: number; invalid: number },
    ) => {
      expect(actorId).toBe("admin-user");
      expect(initialCounts).toEqual({ scanned: 3, invalid: 1 });
      expect(candidates.map((candidate) => candidate.id)).toEqual([importedId, duplicateId]);
      expect(candidates.every((candidate) => candidate.submittedAt.toISOString()
        === "2026-07-01T00:00:00.000Z")).toBe(true);
      return { ...initialCounts, imported: 1, duplicate: 1 };
    });
    const repository = {
      importLegacySubmissionsAtomically,
    } as unknown as DrizzleReviewRepository;

    const counts = await importLegacyRuntimeSubmissions("admin-user", repository);

    expect(counts).toEqual({ scanned: 3, imported: 1, duplicate: 1, invalid: 1 });
    expect(importLegacySubmissionsAtomically).toHaveBeenCalledOnce();
    expect(cacheState.delete).not.toHaveBeenCalled();
  });

  it("does not report success or discard legacy cache when the atomic database operation fails", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    cacheState.values.clear();
    cacheState.delete.mockReset();
    cacheState.values.set("pending-index-v1", [id]);
    cacheState.values.set(`pending:${id}`, {
      game: "lol",
      league: "Legacy failure case",
      teamA: "Alpha",
      teamB: "Beta",
      scheduledAt: "2026-08-01T00:00:00.000Z",
      bestOf: 3,
      sourceUrl: "https://example.com/legacy",
      submittedAt: "2026-07-01T00:00:00.000Z",
    });
    const repository = {
      importLegacySubmissionsAtomically: vi.fn().mockRejectedValue(new Error("database unavailable")),
    } as unknown as DrizzleReviewRepository;

    await expect(importLegacyRuntimeSubmissions("admin-user", repository))
      .rejects.toThrow("database unavailable");
    expect(cacheState.delete).not.toHaveBeenCalled();
  });
});
