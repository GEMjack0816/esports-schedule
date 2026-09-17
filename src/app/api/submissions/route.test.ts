import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSubmissionPost } from "./route";
import { SUBMISSION_REQUEST_POLICY } from "@/lib/submission-request-policy";

const valid = {
  game: "lol",
  league: "LPL",
  teamA: "Alpha",
  teamB: "Beta",
  scheduledAt: "2026-08-01T00:00:00.000Z",
  bestOf: 3,
  sourceUrl: "https://example.com/source",
  notes: null,
  website: "",
};

function request(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request("https://example.com/api/submissions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-real-ip": "203.0.113.10",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function streamRequest(
  chunks: string[],
  options: { contentLength?: string; onCancel?: () => void; onPull?: () => void } = {},
) {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      options.onPull?.();
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunk));
    },
    cancel() {
      options.onCancel?.();
    },
  }, { highWaterMark: 0 });
  const headers = new Headers({
    "Content-Type": "application/json",
    "x-real-ip": "203.0.113.10",
  });
  if (options.contentLength) headers.set("content-length", options.contentLength);
  return new Request("https://example.com/api/submissions", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("POST /api/submissions", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("rejects a pre-aborted request without pulling its body", async () => {
    const abort = new AbortController();
    abort.abort();
    const onPull = vi.fn();
    const onCancel = vi.fn();
    const createSubmission = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull: onPull, cancel: onCancel }, { highWaterMark: 0 });
    const input = new Request("https://example.com/api/submissions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
      signal: abort.signal, duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await handleSubmissionPost(input, createSubmission);
    expect(response.status).toBe(408);
    expect(onPull).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(createSubmission).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it("bounds a stalled body even when stream cancellation never resolves", async () => {
    vi.useFakeTimers();
    const createSubmission = vi.fn();
    const onCancel = vi.fn(() => new Promise<void>(() => undefined));
    let bodyController: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { bodyController = controller; },
      cancel: onCancel,
    });
    const input = new Request("https://example.com/api/submissions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half",
    } as RequestInit & { duplex: "half" });
    let completed = false;
    const pending = handleSubmissionPost(input, createSubmission).then(response => {
      completed = true;
      return response;
    });
    try {
      await vi.advanceTimersByTimeAsync(SUBMISSION_REQUEST_POLICY.maxBodyReadMs);
      expect(completed).toBe(true);
      const response = await pending;
      expect(response.status).toBe(408);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(onCancel).toHaveBeenCalledOnce();
      expect(createSubmission).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (!completed) bodyController!.close();
      await pending;
    }
  });

  it("does not reset the total deadline when small chunks keep arriving", async () => {
    vi.useFakeTimers();
    const createSubmission = vi.fn();
    const onCancel = vi.fn();
    let bodyController: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { bodyController = controller; }, cancel: onCancel,
    });
    const input = new Request("https://example.com/api/submissions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half",
    } as RequestInit & { duplex: "half" });
    const pending = handleSubmissionPost(input, createSubmission);
    await vi.advanceTimersByTimeAsync(SUBMISSION_REQUEST_POLICY.maxBodyReadMs - 1);
    bodyController!.enqueue(new TextEncoder().encode("{"));
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(408);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(createSubmission).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds empty chunk floods independently of their byte count", async () => {
    const createSubmission = vi.fn();
    const onCancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls += 1; controller.enqueue(new Uint8Array()); }, cancel: onCancel,
    }, { highWaterMark: 0 });
    const input = new Request("https://example.com/api/submissions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await handleSubmissionPost(input, createSubmission);
    expect(response.status).toBe(413);
    expect(pulls).toBe(SUBMISSION_REQUEST_POLICY.maxBodyChunks + 1);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(createSubmission).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it("clears the reader deadline after an ordinary valid body", async () => {
    vi.useFakeTimers();
    const createSubmission = vi.fn(async () => ({ kind: "duplicate" as const }));
    const response = await handleSubmissionPost(request(valid), createSubmission);
    expect(response.status).toBe(409);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SUBMISSION_REQUEST_POLICY.maxBodyReadMs);
    expect(createSubmission).toHaveBeenCalledOnce();
  });

  it("stops reading an aborted request before repository work", async () => {
    const abort = new AbortController();
    const createSubmission = vi.fn();
    const onCancel = vi.fn();
    let bodyController: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { bodyController = controller; },
      cancel: onCancel,
    });
    const input = new Request("https://example.com/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: abort.signal,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    let completed = false;
    const pending = handleSubmissionPost(input, createSubmission).then(response => {
      completed = true;
      return response;
    });
    try {
      abort.abort();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(completed).toBe(true);
      expect((await pending).status).toBe(408);
      expect(onCancel).toHaveBeenCalledOnce();
      expect(createSubmission).not.toHaveBeenCalled();
    } finally {
      // Release the pre-fix stalled read so the regression itself leaves no hanging task.
      if (!completed) bodyController!.close();
      await pending;
    }
  });

  it("returns only the public receipt fields and no-store headers", async () => {
    const createSubmission = vi.fn(async (...args: unknown[]) => {
      expect(args).toHaveLength(2);
      return {
        kind: "created" as const,
        submission: {
          id: "11111111-1111-4111-8111-111111111111",
          status: "pending",
          submittedAt: new Date("2026-07-26T00:00:00.000Z"),
          sourceUrl: "https://secret-ish.example/source",
          notes: "not returned",
        },
      };
    });
    const response = await handleSubmissionPost(request(valid), createSubmission);
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(payload).toEqual({
      ok: true,
      id: "11111111-1111-4111-8111-111111111111",
      status: "pending",
      submittedAt: "2026-07-26T00:00:00.000Z",
      message: "已保存为待审核，审核通过前不会公开。",
    });
    expect(createSubmission.mock.calls[0]?.[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(createSubmission.mock.calls[0]?.[0]).toMatchObject({
      kind: "submission",
      input: expect.objectContaining({ league: "LPL" }),
    });
  });

  it("returns 409 for an active duplicate fingerprint", async () => {
    const createSubmission = async () => ({ kind: "duplicate" as const });
    const response = await handleSubmissionPost(request(valid), createSubmission);
    expect(response.status).toBe(409);
  });

  it("accepts a same-origin browser request with a JSON media type parameter", async () => {
    const createSubmission = vi.fn(async () => ({ kind: "duplicate" as const }));
    const response = await handleSubmissionPost(request(valid, {
      Origin: "https://example.com",
      "Content-Type": "application/json; charset=utf-8",
    }), createSubmission);

    expect(response.status).toBe(409);
    expect(createSubmission).toHaveBeenCalledTimes(1);
  });

  it.each(["https://attacker.example", "null", "not an origin"])(
    "rejects a browser submission from an untrusted origin: %s",
    async (origin) => {
      const createSubmission = vi.fn();
      const response = await handleSubmissionPost(request(valid, { Origin: origin }), createSubmission);

      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(createSubmission).not.toHaveBeenCalled();
    },
  );

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""])(
    "rejects a non-JSON submission media type before database work: %s",
    async (contentType) => {
      const createSubmission = vi.fn();
      const submitted = request(valid, { "Content-Type": contentType });
      if (!contentType) submitted.headers.delete("content-type");
      const response = await handleSubmissionPost(submitted, createSubmission);

      expect(response.status).toBe(415);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(createSubmission).not.toHaveBeenCalled();
    },
  );

  it("returns 429 with Retry-After when the source window is exhausted", async () => {
    const response = await handleSubmissionPost(
      request(valid),
      async () => ({ kind: "source-rate-limited", retryAfterSeconds: 321 }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("321");
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("频繁") });
  });

  it.each([
    ["global-rate-limited" as const, "流量"],
    ["new-source-rate-limited" as const, "流量"],
    ["service-busy" as const, "繁忙"],
  ])("returns a bounded 429 response for %s", async (kind, message) => {
    const response = await handleSubmissionPost(
      request(valid),
      async () => ({ kind, retryAfterSeconds: 5 }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining(message) });
  });

  it("returns 429 with Retry-After when the global pending queue is full", async () => {
    const response = await handleSubmissionPost(
      request(valid),
      async () => ({ kind: "queue-full", retryAfterSeconds: 900 }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("队列") });
  });

  it.each([
    { ...valid, league: "LPL\u0000spoof" },
    { ...valid, teamA: "Alpha\u202Etxt.exe" },
    { ...valid, sourceUrl: "https://user:password@example.com/match" },
  ])("rejects unsafe text before repository work", async (candidate) => {
    const createSubmission = vi.fn();
    const response = await handleSubmissionPost(request(candidate), createSubmission);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("returns 503 without pretending success when PostgreSQL is unavailable", async () => {
    const createSubmission = async () => {
      throw Object.assign(new Error("unavailable"), { code: "DATABASE_UNAVAILABLE" });
    };
    const response = await handleSubmissionPost(request(valid), createSubmission);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("routes a honeypot hit through abuse protection without exposing a record id", async () => {
    const createSubmission = vi.fn(async () => ({ kind: "honeypot" as const }));
    const response = await handleSubmissionPost(
      request({ ...valid, website: "spam.example" }),
      createSubmission,
    );
    expect(response.status).toBe(201);
    expect(createSubmission).toHaveBeenCalledWith(
      { kind: "honeypot" },
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(await response.json()).not.toHaveProperty("id");
  });

  it.each([
    "source-rate-limited" as const,
    "global-rate-limited" as const,
    "new-source-rate-limited" as const,
    "service-busy" as const,
  ])("does not let honeypot requests bypass %s", async (kind) => {
    const createSubmission = vi.fn(async () => ({ kind, retryAfterSeconds: 17 }));
    const response = await handleSubmissionPost(
      request({ website: "spam.example" }),
      createSubmission,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(createSubmission).toHaveBeenCalledOnce();
  });

  it("rejects payloads above 10 KB", async () => {
    const createSubmission = vi.fn();
    const response = await handleSubmissionPost(
      request({ ...valid, notes: "x".repeat(10_001) }),
      createSubmission,
    );
    expect(response.status).toBe(413);
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("rejects a multibyte body above 10 KB even when its character count is smaller", async () => {
    const createSubmission = vi.fn();
    const body = JSON.stringify({ ...valid, padding: "界".repeat(4_000) });
    expect(body.length).toBeLessThan(10_000);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(10_000);

    const response = await handleSubmissionPost(streamRequest([body]), createSubmission);

    expect(response.status).toBe(413);
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("stops reading and cancels an oversized chunked request", async () => {
    const createSubmission = vi.fn();
    const onCancel = vi.fn();
    const onPull = vi.fn();
    const response = await handleSubmissionPost(
      streamRequest(["x".repeat(6_000), "y".repeat(5_000), "z".repeat(1_000)], {
        onCancel,
        onPull,
      }),
      createSubmission,
    );

    expect(response.status).toBe(413);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPull).toHaveBeenCalledTimes(2);
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared content length without reading the body", async () => {
    const createSubmission = vi.fn();
    const onCancel = vi.fn();
    const response = await handleSubmissionPost(
      streamRequest([JSON.stringify(valid)], { contentLength: "10001", onCancel }),
      createSubmission,
    );

    expect(response.status).toBe(413);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(createSubmission).not.toHaveBeenCalled();
  });
});
