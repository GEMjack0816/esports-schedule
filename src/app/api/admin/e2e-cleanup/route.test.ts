import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  trustedMutationOrigin: vi.fn(),
  getReviewRepository: vi.fn(),
  synchronizePublishedManualMatchesSnapshot: vi.fn(),
  revalidateTag: vi.fn(),
  cleanupE2eVerificationRun: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/auth/admin-page", () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock("@/lib/auth/vercel", () => ({ trustedMutationOrigin: mocks.trustedMutationOrigin }));
vi.mock("@/lib/review/repository", () => ({ getReviewRepository: mocks.getReviewRepository }));
vi.mock("@/lib/review/public-matches", () => ({
  synchronizePublishedManualMatchesSnapshot: mocks.synchronizePublishedManualMatchesSnapshot,
}));

import { POST } from "./route";

const runId = "a1cddf2d-18c4-4e1b-96d8-c7778c536030";

function request(body: unknown = { runId }) {
  return new Request("https://preview.example.vercel.app/api/admin/e2e-cleanup", {
    method: "POST",
    headers: {
      origin: "https://preview.example.vercel.app",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function streamedRequest(chunks: Uint8Array[], onCancel: () => void) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index += 1;
      } else {
        controller.close();
      }
    },
    cancel() {
      onCancel();
    },
  });

  return new Request("https://preview.example.vercel.app/api/admin/e2e-cleanup", {
    method: "POST",
    headers: { origin: "https://preview.example.vercel.app" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("Preview-only admin E2E cleanup endpoint", () => {
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
    mocks.getReviewRepository.mockReset().mockReturnValue({
      cleanupE2eVerificationRun: mocks.cleanupE2eVerificationRun,
    });
    mocks.cleanupE2eVerificationRun.mockReset().mockResolvedValue({
      cleaned: true,
      submissionsDeleted: 1,
      matchesDeleted: 1,
    });
    mocks.synchronizePublishedManualMatchesSnapshot.mockReset().mockResolvedValue({});
    mocks.revalidateTag.mockReset();
  });

  it.each([
    ["production", "safety/verify-admin-preview-target"],
    ["preview", "main"],
    ["preview", "another-preview-branch"],
    ["", "safety/verify-admin-preview-target"],
  ])("is unavailable outside its exact Preview branch", async (environment, ref) => {
    vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", ref);
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.requireAdminApi).not.toHaveBeenCalled();
    expect(mocks.cleanupE2eVerificationRun).not.toHaveBeenCalled();
  });

  it("requires an authenticated admin session", async () => {
    mocks.requireAdminApi.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.cleanupE2eVerificationRun).not.toHaveBeenCalled();
  });

  it("rejects invalid origin and malformed payloads without touching records", async () => {
    mocks.trustedMutationOrigin.mockImplementationOnce(() => { throw new Error("origin"); });
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request({ runId: "not-a-uuid" }))).status).toBe(400);
    expect(mocks.cleanupE2eVerificationRun).not.toHaveBeenCalled();
  });

  it("cleans only run-scoped records and refreshes the public manual-match cache", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.cleanupE2eVerificationRun).toHaveBeenCalledWith(runId);
    expect(mocks.synchronizePublishedManualMatchesSnapshot).toHaveBeenCalledOnce();
    expect(mocks.revalidateTag).toHaveBeenCalledWith("published-manual-matches", { expire: 0 });
  });

  it("fails closed on body limits and run-marker conflicts", async () => {
    const tooLarge = new Request("https://preview.example.vercel.app/api/admin/e2e-cleanup", {
      method: "POST",
      headers: { origin: "https://preview.example.vercel.app" },
      body: "x".repeat(5_000),
    });
    expect((await POST(tooLarge)).status).toBe(413);
    mocks.cleanupE2eVerificationRun.mockResolvedValueOnce({
      cleaned: false,
      submissionsDeleted: 0,
      matchesDeleted: 0,
    });
    expect((await POST(request())).status).toBe(409);
  });

  it("cancels an oversized chunked body without Content-Length before parsing or writing", async () => {
    let cancelled = false;
    const tooLarge = streamedRequest([
      new Uint8Array(2_048),
      new Uint8Array(2_049),
      ...Array.from({ length: 10 }, () => new Uint8Array(4_096)),
    ], () => { cancelled = true; });

    const response = await POST(tooLarge);
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.cleanupE2eVerificationRun).not.toHaveBeenCalled();
    expect(mocks.synchronizePublishedManualMatchesSnapshot).not.toHaveBeenCalled();
  });

  it("rejects malformed Content-Length before reading the request body", async () => {
    const malformed = new Request("https://preview.example.vercel.app/api/admin/e2e-cleanup", {
      method: "POST",
      headers: {
        origin: "https://preview.example.vercel.app",
        "content-length": "unknown",
      },
      body: JSON.stringify({ runId }),
    });

    const response = await POST(malformed);
    expect(response.status).toBe(400);
    expect(mocks.cleanupE2eVerificationRun).not.toHaveBeenCalled();
  });

  it("returns a non-success result if the committed rows are deleted but cache recovery fails", async () => {
    mocks.synchronizePublishedManualMatchesSnapshot.mockRejectedValueOnce(new Error("cache unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ cleaned: true, cacheRefreshed: false });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("published-manual-matches", { expire: 0 });
  });
});
