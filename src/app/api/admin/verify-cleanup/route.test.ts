import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminApi, trustedMutationOrigin, cleanupVerificationRun, getPreviewDatabaseTargetFingerprint } = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  trustedMutationOrigin: vi.fn(),
  cleanupVerificationRun: vi.fn(),
  getPreviewDatabaseTargetFingerprint: vi.fn(),
}));

vi.mock("@/lib/auth/admin-page", () => ({ requireAdminApi }));
vi.mock("@/lib/auth/vercel", () => ({ trustedMutationOrigin }));
vi.mock("@/db/identity", () => ({ getPreviewDatabaseTargetFingerprint }));
vi.mock("@/lib/review/service", () => ({ cleanupVerificationRun }));

import { POST } from "./route";

const runId = "eac53db6-16b4-4bd0-877a-e3ed5f4fe2b1";
const databaseFingerprint = "a".repeat(64);

function request(body: unknown = { runId, expectedDatabaseFingerprint: databaseFingerprint }) {
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
    getPreviewDatabaseTargetFingerprint.mockReset().mockReturnValue(databaseFingerprint);
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

  it.each([null, "b".repeat(64)])("fails closed when the Preview database identity is missing or mismatched", async (actual) => {
    getPreviewDatabaseTargetFingerprint.mockReturnValue(actual);

    const response = await POST(request({ runId, expectedDatabaseFingerprint: databaseFingerprint }));

    expect(response.status).toBe(503);
    expect(cleanupVerificationRun).not.toHaveBeenCalled();
  });

  it("fails closed when the request omits or malforms its expected database fingerprint", async () => {
    const missing = await POST(request({ runId }));
    const malformed = await POST(request({ runId, expectedDatabaseFingerprint: "not-a-fingerprint" }));

    expect(missing.status).toBe(503);
    expect(malformed.status).toBe(503);
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
    const response = await POST(request({ runId, expectedDatabaseFingerprint: databaseFingerprint }));

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

  it("rejects a declared oversized body before reading it", async () => {
    const requestWithLength = new Request("https://preview.example/api/admin/verify-cleanup", {
      method: "POST",
      headers: {
        origin: "https://preview.example",
        "content-type": "application/json",
        "content-length": "1025",
      },
      body: JSON.stringify({ runId, expectedDatabaseFingerprint: databaseFingerprint }),
    });

    const response = await POST(requestWithLength);

    expect(response.status).toBe(413);
    expect(cleanupVerificationRun).not.toHaveBeenCalled();
  });

  it("cancels a streamed body as soon as the byte limit is crossed", async () => {
    let secondChunkPulled = false;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (secondChunkPulled) return;
        secondChunkPulled = true;
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(400));
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamedRequest = new Request("https://preview.example/api/admin/verify-cleanup", {
      method: "POST",
      headers: { origin: "https://preview.example", "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);

    const response = await POST(streamedRequest);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(cleanupVerificationRun).not.toHaveBeenCalled();
  });

  it("returns 408 and cancels body reading when the client disconnects", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        cancelled = true;
      },
    });
    const abortedRequest = new Request("https://preview.example/api/admin/verify-cleanup", {
      method: "POST",
      headers: { origin: "https://preview.example", "content-type": "application/json" },
      body,
      signal: controller.signal,
      duplex: "half",
    } as RequestInit);

    const pendingResponse = POST(abortedRequest);
    controller.abort();
    const response = await pendingResponse;

    expect(response.status).toBe(408);
    expect(cleanupVerificationRun).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
  });

  it("enforces the body limit in UTF-8 bytes, not JavaScript characters", async () => {
    const body = JSON.stringify({ runId, padding: "界".repeat(400) });
    expect(body.length).toBeLessThan(1_024);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(1_024);

    const response = await POST(request({ runId, expectedDatabaseFingerprint: databaseFingerprint, padding: "界".repeat(400) }));

    expect(response.status).toBe(413);
    expect(cleanupVerificationRun).not.toHaveBeenCalled();
  });
});
