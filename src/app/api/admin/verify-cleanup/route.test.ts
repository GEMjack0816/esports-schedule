import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminApi, trustedMutationOrigin, cleanupVerificationRun } = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  trustedMutationOrigin: vi.fn(),
  cleanupVerificationRun: vi.fn(),
}));

vi.mock("@/lib/auth/admin-page", () => ({ requireAdminApi }));
vi.mock("@/lib/auth/vercel", () => ({ trustedMutationOrigin }));
vi.mock("@/lib/review/service", () => ({ cleanupVerificationRun }));

import { POST } from "./route";

const runId = "eac53db6-16b4-4bd0-877a-e3ed5f4fe2b1";

function request(body: unknown = { runId }) {
  return new Request("https://preview.example/api/admin/verify-cleanup", {
    method: "POST",
    headers: { origin: "https://preview.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/verify-cleanup", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    requireAdminApi.mockReset().mockResolvedValue({ ok: true, sub: "admin-sub" });
    trustedMutationOrigin.mockReset();
    cleanupVerificationRun.mockReset().mockResolvedValue({ submissions: 2, manualMatches: 1, auditEvents: 5 });
  });

  it("is unavailable outside the Preview runtime", async () => {
    vi.stubEnv("VERCEL_ENV", "production");

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(requireAdminApi).not.toHaveBeenCalled();
    expect(cleanupVerificationRun).not.toHaveBeenCalled();
  });

  it("requires an authenticated admin", async () => {
    requireAdminApi.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(cleanupVerificationRun).not.toHaveBeenCalled();
  });

  it("rejects an invalid Origin before cleanup", async () => {
    trustedMutationOrigin.mockImplementation(() => { throw new Error("untrusted"); });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(cleanupVerificationRun).not.toHaveBeenCalled();
  });

  it.each([
    { runId: "not-a-uuid" },
    { runId: "../production" },
    null,
    [runId],
  ])("rejects malformed cleanup identifiers", async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(cleanupVerificationRun).not.toHaveBeenCalled();
  });

  it("cleans only the requested run and returns non-sensitive counts", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(cleanupVerificationRun).toHaveBeenCalledWith(runId);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      runId,
      counts: { submissions: 2, manualMatches: 1, auditEvents: 5 },
    });
  });

  it("does not expose database errors", async () => {
    cleanupVerificationRun.mockRejectedValue(new Error("sensitive database details"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Preview 验证数据清理失败。",
    });
  });
});
