import { describe, expect, it, vi } from "vitest";
import { handleSubmissionPost } from "./route";

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

function request(body: unknown) {
  return new Request("https://example.com/api/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": "203.0.113.10" },
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
  });

  it("returns 409 for an active duplicate fingerprint", async () => {
    const createSubmission = async () => ({ kind: "duplicate" as const });
    const response = await handleSubmissionPost(request(valid), createSubmission);
    expect(response.status).toBe(409);
  });

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

  it("returns 503 without pretending success when PostgreSQL is unavailable", async () => {
    const createSubmission = async () => {
      throw Object.assign(new Error("unavailable"), { code: "DATABASE_UNAVAILABLE" });
    };
    const response = await handleSubmissionPost(request(valid), createSubmission);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("accepts a honeypot hit without writing or exposing a record id", async () => {
    const createSubmission = vi.fn();
    const response = await handleSubmissionPost(
      request({ ...valid, website: "spam.example" }),
      createSubmission,
    );
    expect(response.status).toBe(201);
    expect(createSubmission).not.toHaveBeenCalled();
    expect(await response.json()).not.toHaveProperty("id");
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
