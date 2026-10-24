import { describe, expect, it, vi } from "vitest";
import type { DrizzleReviewRepository } from "./repository";

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  unstable_cache: (callback: unknown) => callback,
}));

import { createManualMatch, toggleManualMatchHidden } from "./service";

describe("manual match visibility service", () => {
  it("rejects a missing idempotency key before attempting a manual match write", async () => {
    const repository = { createManualMatch: vi.fn() } as unknown as DrizzleReviewRepository;
    await expect(createManualMatch({}, "admin-1", null, repository, {
      synchronize: vi.fn(),
      invalidate: vi.fn(),
    })).rejects.toThrow("操作标识无效");
    expect(repository.createManualMatch).not.toHaveBeenCalled();
  });

  it("delegates the atomic toggle and invalidates the public match cache", async () => {
    const row = { id: "match-1", hidden: true };
    const repository = {
      toggleManualMatchHidden: vi.fn().mockResolvedValue(row),
    } as unknown as DrizzleReviewRepository;
    const fence = vi.fn().mockResolvedValue(undefined);
    const effects = {
      fence,
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
      fence,
    );
    expect(effects.synchronize).toHaveBeenCalledWith(repository);
    expect(effects.invalidate).toHaveBeenCalledOnce();
  });

  it("does not report a committed mutation as failed when cache synchronization is pending", async () => {
    const row = { id: "match-2", hidden: false };
    const repository = {
      toggleManualMatchHidden: vi.fn().mockResolvedValue(row),
    } as unknown as DrizzleReviewRepository;
    const effects = {
      synchronize: vi.fn().mockRejectedValue(new Error("runtime cache unavailable")),
      invalidate: vi.fn(),
    };

    await expect(toggleManualMatchHidden(
      "match-2",
      "admin-1",
      "2026-08-20T00:00:00.000Z",
      repository,
      effects,
    )).resolves.toBe(row);
    expect(effects.invalidate).toHaveBeenCalledOnce();
  });

  it("does not report a committed mutation as failed when Next Data Cache invalidation fails", async () => {
    const row = { id: "match-3", hidden: true };
    const repository = {
      toggleManualMatchHidden: vi.fn().mockResolvedValue(row),
    } as unknown as DrizzleReviewRepository;
    const effects = {
      synchronize: vi.fn().mockResolvedValue(undefined),
      invalidate: vi.fn(() => { throw new Error("next cache unavailable"); }),
    };

    await expect(toggleManualMatchHidden(
      "match-3",
      "admin-1",
      "2026-08-20T00:00:00.000Z",
      repository,
      effects,
    )).resolves.toBe(row);
  });
});

