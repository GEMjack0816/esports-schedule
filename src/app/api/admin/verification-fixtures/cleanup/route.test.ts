import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  trustedMutationOrigin: vi.fn(),
  getReviewRepository: vi.fn(),
  synchronizePublishedManualMatchesSnapshot: vi.fn(),
  revalidateTag: vi.fn(),
  cleanupAdminVerificationRun: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/auth/admin-page", () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock("@/lib/auth/vercel", () => ({ trustedMutationOrigin: mocks.trustedMutationOrigin }));
vi.mock("@/lib/review/public-matches", () => ({
  synchronizePublishedManualMatchesSnapshot: mocks.synchronizePublishedManualMatchesSnapshot,
}));
vi.mock("@/lib/review/repository", () => ({ getReviewRepository: mocks.getReviewRepository }));

import { POST } from "./route";

const runId = "123e4567-e89b-42d3-a456-426614174000";
const expectedRef = "codex/issue9-verify-admin-preview-guard";
const expectedSha = "a".repeat(40);

function request(body: Record<string, unknown> = {
  runId,
  expectedRef,
  expectedSha,
}) {
  return new Request("https://preview.example.vercel.app/api/admin/verification-fixtures/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://preview.example.vercel.app" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", expectedRef);
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", expectedSha);
  mocks.requireAdminApi.mockResolvedValue({ ok: true, sub: "admin-stable-id" });
  mocks.trustedMutationOrigin.mockReturnValue("https://preview.example.vercel.app");
  mocks.cleanupAdminVerificationRun.mockResolvedValue({ deletedSubmissions: 1, deletedPublishedMatches: 1 });
  mocks.getReviewRepository.mockReturnValue({ cleanupAdminVerificationRun: mocks.cleanupAdminVerificationRun });
  mocks.synchronizePublishedManualMatchesSnapshot.mockResolvedValue({ matches: [], fetchedAt: new Date().toISOString() });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/admin/verification-fixtures/cleanup", () => {
  it("is unavailable outside a Preview deployment", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.requireAdminApi).not.toHaveBeenCalled();
    expect(mocks.cleanupAdminVerificationRun).not.toHaveBeenCalled();
  });

  it("fails closed when ref or SHA does not exactly match this Preview deployment", async () => {
    const response = await POST(request({ runId, expectedRef: "other-branch", expectedSha }));

    expect(response.status).toBe(409);
    expect(mocks.requireAdminApi).not.toHaveBeenCalled();
    expect(mocks.cleanupAdminVerificationRun).not.toHaveBeenCalled();
  });

  it("requires an administrator and same-origin request before cleanup", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const unauthorized = await POST(request());
    expect(unauthorized.status).toBe(401);
    expect(mocks.cleanupAdminVerificationRun).not.toHaveBeenCalled();

    mocks.trustedMutationOrigin.mockImplementationOnce(() => { throw new Error("invalid origin"); });
    const crossOrigin = await POST(request());
    expect(crossOrigin.status).toBe(403);
    expect(mocks.cleanupAdminVerificationRun).not.toHaveBeenCalled();
  });

  it("deletes only the requested run and refreshes the public cache when matches were removed", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, deletedSubmissions: 1, deletedPublishedMatches: 1 });
    expect(mocks.cleanupAdminVerificationRun).toHaveBeenCalledWith(runId);
    expect(mocks.synchronizePublishedManualMatchesSnapshot).toHaveBeenCalledOnce();
    expect(mocks.revalidateTag).toHaveBeenCalledWith("published-manual-matches", { expire: 0 });
  });

  it("does not touch the published cache when the run only contains submissions", async () => {
    mocks.cleanupAdminVerificationRun.mockResolvedValueOnce({ deletedSubmissions: 1, deletedPublishedMatches: 0 });
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.synchronizePublishedManualMatchesSnapshot).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("returns a generic failure without exposing database errors", async () => {
    mocks.cleanupAdminVerificationRun.mockRejectedValueOnce(new Error("postgres host secret-value"));
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-value");
  });
});
