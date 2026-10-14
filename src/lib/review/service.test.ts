import { describe, expect, it, vi } from "vitest";
import type { DrizzleReviewRepository } from "./repository";

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  unstable_cache: (callback: unknown) => callback,
}));

import { cleanupVerificationRun, toggleManualMatchHidden } from "./service";

describe("manual match visibility service", () => {
  it("delegates the atomic toggle and invalidates the public match cache", async () => {
    const row = { id: "match-1", hidden: true };
    const repository = {
      toggleManualMatchHidden: vi.fn().mockResolvedValue(row),
    } as unknown as DrizzleReviewRepository;
    const effects = {
      synchronize: vi.fn().mockResolvedValue(undefined),
      invalidate: vi.fn(),
    };
    const expectedUpdatedAt = "2026-08-20T00:00:00.000Z";

    await expect(toggleManualMatchHidden(
      "match-1",
      "admin-1",
      expectedUpdatedAt,
      repository,
      effects,
    ))
      .resolves.toBe(row);
    expect(repository.toggleManualMatchHidden).toHaveBeenCalledWith(
      "match-1",
      "admin-1",
      new Date(expectedUpdatedAt),
    );
    expect(effects.synchronize).toHaveBeenCalledWith(repository);
    expect(effects.invalidate).toHaveBeenCalledOnce();
  });
});

describe("verification run cleanup service", () => {
  it("re-synchronizes the Runtime Cache even for an idempotent retry", async () => {
    const counts = { submissions: 0, manualMatches: 0, auditEvents: 0 };
    const repository = {
      cleanupAdminVerificationRun: vi.fn().mockResolvedValue(counts),
    } as unknown as DrizzleReviewRepository;
    const effects = {
      synchronize: vi.fn().mockResolvedValue(undefined),
      invalidate: vi.fn(),
    };

    await expect(cleanupVerificationRun("eac53db6-16b4-4bd0-877a-e3ed5f4fe2b1", repository, effects))
      .resolves.toBe(counts);

    expect(repository.cleanupAdminVerificationRun).toHaveBeenCalledOnce();
    expect(effects.synchronize).toHaveBeenCalledWith(repository);
    expect(effects.invalidate).toHaveBeenCalledOnce();
  });

  it("does not report verification cleanup success when cache synchronization fails", async () => {
    const repository = {
      cleanupAdminVerificationRun: vi.fn().mockResolvedValue({
        submissions: 0,
        manualMatches: 0,
        auditEvents: 0,
      }),
    } as unknown as DrizzleReviewRepository;
    const effects = {
      synchronize: vi.fn().mockRejectedValue(new Error("cache synchronization failed")),
      invalidate: vi.fn(),
    };

    await expect(cleanupVerificationRun(
      "eac53db6-16b4-4bd0-877a-e3ed5f4fe2b1",
      repository,
      effects,
    )).rejects.toThrow("cache synchronization failed");

    expect(effects.invalidate).toHaveBeenCalledOnce();
  });
});
