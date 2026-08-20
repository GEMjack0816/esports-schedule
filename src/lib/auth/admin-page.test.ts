import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

import { requireAdminAction } from "./admin-page";

describe("administrator action authorization", () => {
  it("loads the current session for every action invocation", async () => {
    const loadSession = vi.fn()
      .mockResolvedValueOnce({ sub: "admin-current" })
      .mockResolvedValueOnce(null);

    await expect(requireAdminAction("/admin/matches/1", loadSession))
      .resolves.toEqual({ sub: "admin-current" });
    await expect(requireAdminAction("/admin/matches/1", loadSession))
      .rejects.toThrow("redirect:/admin/login?returnTo=%2Fadmin%2Fmatches%2F1");
    expect(loadSession).toHaveBeenCalledTimes(2);
  });
});
