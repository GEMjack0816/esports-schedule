import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  trustedMutationOrigin: vi.fn(),
}));

vi.mock("@/lib/auth/admin-page", () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock("@/lib/auth/vercel", () => ({ trustedMutationOrigin: mocks.trustedMutationOrigin }));

import { POST } from "./route";

function request() {
  return new Request("https://preview.example.vercel.app/api/admin/e2e-preflight", {
    method: "POST",
    headers: { origin: "https://preview.example.vercel.app" },
  });
}

describe("Preview admin E2E database preflight", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "safety/verify-admin-preview-target");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_preview");
    vi.stubEnv("VERCEL_URL", "preview.example.vercel.app");
    vi.stubEnv("DATABASE_URL", "postgres://review:placeholder@preview-db.example.test/app_test");
    vi.stubEnv("ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS", "preview-db.example.test");
    vi.stubEnv("ADMIN_VERIFY_PREVIEW_GIT_REFS", "safety/verify-admin-preview-target");
    mocks.requireAdminApi.mockReset().mockResolvedValue({ ok: true, sub: "admin-test" });
    mocks.trustedMutationOrigin.mockReset();
  });

  it("confirms only an authenticated same-origin request with an allowlisted runtime DB", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.requireAdminApi).toHaveBeenCalledOnce();
    expect(mocks.trustedMutationOrigin).toHaveBeenCalledOnce();
  });

  it("fails closed before authentication when the runtime DB is not allowlisted", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://review:placeholder@production-db.example.test/app_test");
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(mocks.requireAdminApi).not.toHaveBeenCalled();
  });

  it("requires an admin session and a trusted same-origin request", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await POST(request())).status).toBe(401);

    mocks.requireAdminApi.mockResolvedValueOnce({ ok: true, sub: "admin-test" });
    mocks.trustedMutationOrigin.mockImplementationOnce(() => { throw new Error("origin"); });
    expect((await POST(request())).status).toBe(403);
  });
});
