import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  trustedMutationOrigin: vi.fn(),
  cleanup: vi.fn(),
  fence: vi.fn(),
  synchronize: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/auth/admin-page", () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock("@/lib/auth/vercel", () => ({ trustedMutationOrigin: mocks.trustedMutationOrigin }));
vi.mock("@/lib/review/public-matches", () => ({
  synchronizePublishedManualMatchesSnapshot: mocks.synchronize,
  writeManualMatchCacheFence: mocks.fence,
}));
vi.mock("@/lib/review/repository", () => ({
  getReviewRepository: () => ({ cleanupIsolatedVerificationRun: mocks.cleanup }),
}));
vi.mock("next/cache", () => ({ revalidateTag: mocks.invalidate }));

import { POST } from "./route";

const id = "11111111-1111-4111-8111-111111111111";

function request(body: unknown) {
  return new Request("https://preview.example/api/admin/verification-cleanup", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://preview.example" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/verification-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "sha");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "fix/ref");
    mocks.requireAdminApi.mockResolvedValue({ ok: true, sub: "admin" });
    mocks.cleanup.mockResolvedValue({ submissions: 1, manualMatches: 1, auditEvents: 4 });
    mocks.synchronize.mockResolvedValue(undefined);
  });

  it("cleans only an authenticated run bound to the current Preview identity", async () => {
    const response = await POST(request({
      submissionIds: [id],
      league: "Codex isolated review run",
      gitCommitSha: "sha",
      gitCommitRef: "fix/ref",
    }));
    expect(response.status).toBe(200);
    expect(mocks.cleanup).toHaveBeenCalledWith([id], "Codex isolated review run", mocks.fence);
    expect(mocks.synchronize).toHaveBeenCalledOnce();
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.invalidate).toHaveBeenCalledWith("published-manual-matches", { expire: 0 });
  });

  it("is unavailable outside Preview", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await POST(request({}));
    expect(response.status).toBe(404);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("fails closed when SHA or ref do not match", async () => {
    const response = await POST(request({
      submissionIds: [id],
      league: "Codex isolated review run",
      gitCommitSha: "wrong",
      gitCommitRef: "fix/ref",
    }));
    expect(response.status).toBe(409);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("requires an authenticated administrator", async () => {
    mocks.requireAdminApi.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const response = await POST(request({}));
    expect(response.status).toBe(401);
  });
});
