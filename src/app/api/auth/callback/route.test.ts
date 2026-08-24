import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  completeVercelAuthorization: vi.fn(),
  trustedRequestOrigin: vi.fn(() => "https://preview.example"),
}));

vi.mock("@/lib/auth/vercel", () => ({
  AuthForbiddenError: class AuthForbiddenError extends Error {},
  completeVercelAuthorization: authMocks.completeVercelAuthorization,
  trustedRequestOrigin: authMocks.trustedRequestOrigin,
}));

import { GET } from "./route";

describe("Preview OAuth sub diagnostic callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the verified sub with no-store and noindex headers", async () => {
    authMocks.completeVercelAuthorization.mockResolvedValue({
      kind: "preview-sub-diagnostic",
      sub: "verified-subject",
    });

    const response = await GET(new Request("https://preview.example/api/auth/callback"));
    const body = await response.json();

    expect(body).toEqual({ sub: "verified-subject" });
    expect(Object.keys(body)).toEqual(["sub"]);
    expect(response.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
