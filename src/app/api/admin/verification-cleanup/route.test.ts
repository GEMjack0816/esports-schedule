import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  trustedMutationOrigin: vi.fn(),
  cleanup: vi.fn(),
  synchronize: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth/admin-page", () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock("@/lib/auth/vercel", () => ({ trustedMutationOrigin: mocks.trustedMutationOrigin }));
vi.mock("@/lib/review/public-matches", () => ({
  synchronizePublishedManualMatchesSnapshot: mocks.synchronize,
}));
vi.mock("@/lib/review/repository", () => ({
  getReviewRepository: () => ({ cleanupIsolatedVerificationRun: mocks.cleanup }),
}));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));

import { POST } from "./route";

const runId = "11111111-1111-4111-8111-111111111111";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://preview.example/api/admin/verification-cleanup", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://preview.example", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/verification-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "sha");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "fix/ref");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_preview");
    mocks.requireAdminApi.mockResolvedValue({ ok: true, sub: "admin" });
    mocks.cleanup.mockResolvedValue({ submissions: 1, manualMatches: 1, auditEvents: 4 });
    mocks.synchronize.mockResolvedValue(undefined);
  });

  it("cleans only an authenticated run bound to the current Preview identity", async () => {
    const response = await POST(request({
      runId,
      gitCommitSha: "sha",
      gitCommitRef: "fix/ref",
      deploymentId: "dpl_preview",
    }));
    expect(response.status).toBe(200);
    expect(mocks.cleanup).toHaveBeenCalledWith(runId);
    expect(mocks.synchronize).toHaveBeenCalledOnce();
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      "published-manual-matches",
      { expire: 0 },
    );
  });

  it("is unavailable outside Preview", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await POST(request({}));
    expect(response.status).toBe(404);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it.each([
    ["SHA", { gitCommitSha: "wrong", gitCommitRef: "fix/ref", deploymentId: "dpl_preview" }],
    ["ref", { gitCommitSha: "sha", gitCommitRef: "fix/other", deploymentId: "dpl_preview" }],
    ["deployment", { gitCommitSha: "sha", gitCommitRef: "fix/ref", deploymentId: "dpl_other" }],
  ])("fails closed when %s does not match", async (_label, identity) => {
    const response = await POST(request({
      runId,
      ...identity,
    }));
    expect(response.status).toBe(409);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("requires an authenticated administrator", async () => {
    mocks.requireAdminApi.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const response = await POST(request({}));
    expect(response.status).toBe(401);
  });

  it("rejects a malformed run identifier before cleanup", async () => {
    const response = await POST(request({
      runId: "not-a-uuid",
      gitCommitSha: "sha",
      gitCommitRef: "fix/ref",
      deploymentId: "dpl_preview",
    }));
    expect(response.status).toBe(409);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("bounds streamed request bodies even when Content-Length is absent", async () => {
    const response = await POST(request({
      runId,
      gitCommitSha: "sha",
      gitCommitRef: "fix/ref",
      deploymentId: "dpl_preview",
      extra: "x".repeat(3_000),
    }));

    expect(response.status).toBe(413);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared Content-Length without reading the body", async () => {
    const response = await POST(request({ runId }, { "content-length": "3000" }));

    expect(response.status).toBe(413);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("accepts only application/json media types", async () => {
    const response = await POST(request({
      runId,
      gitCommitSha: "sha",
      gitCommitRef: "fix/ref",
      deploymentId: "dpl_preview",
    }, { "content-type": "application/jsonp" }));

    expect(response.status).toBe(400);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("accepts application/json with a charset parameter", async () => {
    const response = await POST(request({
      runId,
      gitCommitSha: "sha",
      gitCommitRef: "fix/ref",
      deploymentId: "dpl_preview",
    }, { "content-type": "application/json; charset=utf-8" }));

    expect(response.status).toBe(200);
    expect(mocks.cleanup).toHaveBeenCalledWith(runId);
  });

  it.each(["not-a-number", "-1", "1.5"])("rejects invalid Content-Length %s", async (contentLength) => {
    const response = await POST(request({ runId }, { "content-length": contentLength }));

    expect(response.status).toBe(400);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it.each(["null", "[]", "{", "\"string\""])("rejects non-object or malformed JSON: %s", async (body) => {
    const response = await POST(new Request("https://preview.example/api/admin/verification-cleanup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://preview.example" },
      body,
    }));

    expect(response.status).toBe(400);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});

