import { describe, expect, it, vi } from "vitest";
import type { DrizzleReviewRepository } from "./repository";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { toggleManualMatchHidden } from "./service";

describe("manual match visibility service", () => {
  it("delegates the atomic toggle and invalidates the public match cache", async () => {
    const row = { id: "match-1", hidden: true };
    const repository = {
      toggleManualMatchHidden: vi.fn().mockResolvedValue(row),
    } as unknown as DrizzleReviewRepository;
    const invalidate = vi.fn();

    await expect(toggleManualMatchHidden("match-1", "admin-1", repository, invalidate))
      .resolves.toBe(row);
    expect(repository.toggleManualMatchHidden).toHaveBeenCalledWith("match-1", "admin-1");
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
