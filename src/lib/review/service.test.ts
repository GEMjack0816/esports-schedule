import { describe, expect, it, vi } from "vitest";
import type { DrizzleReviewRepository } from "./repository";

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  unstable_cache: (callback: unknown) => callback,
}));

import { toggleManualMatchHidden, validatePublishedMatch } from "./service";

describe("published stream URL validation", () => {
  it("rejects credentialed stream and logo URLs on admin writes", () => {
    const valid = {
      game: "lol",
      league: "League",
      homeTeamName: "A",
      awayTeamName: "B",
    };
    expect(() => validatePublishedMatch({ ...valid, streamUrl: "https://stream.example/live?token=private" }))
      .toThrow("公开链接不能包含账号凭据或访问令牌。");
    expect(() => validatePublishedMatch({ ...valid, homeTeamLogo: "https://cdn.example/logo.svg?signature=private" }))
      .toThrow("公开链接不能包含账号凭据或访问令牌。");
  });
});

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
