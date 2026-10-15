import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestMatchSubmission,
  SUBMISSION_ALREADY_LISTED_MESSAGE,
  SUBMISSION_REQUEST_ERROR,
  SUBMISSION_REQUEST_TIMEOUT_ERROR,
  SUBMISSION_REQUEST_TIMEOUT_MS,
} from "./submission-client";

afterEach(() => vi.useRealTimers());

describe("public submission transport", () => {
  const payload = { game: "lol", league: "LPL" };
  const receipt = {
    ok: true,
    id: "11111111-1111-4111-8111-111111111111",
    status: "pending",
    submittedAt: "2026-09-16T00:00:00.000Z",
    message: "已保存为待审核。",
  };

  it("posts JSON with a deadline and accepts a validated receipt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(receipt, { status: 201 }));

    await expect(requestMatchSubmission(payload, fetcher)).resolves.toEqual({
      ok: true,
      message: receipt.message,
    });
    expect(fetcher).toHaveBeenCalledWith("/api/submissions", {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: expect.any(AbortSignal),
    });
  });

  it.each([400, 413, 415, 429])(
    "shows a bounded public validation message for HTTP %i",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        ok: false,
        error: "请修正提交内容。",
      }, { status }));

      await expect(requestMatchSubmission(payload, fetcher)).resolves.toEqual({
        ok: false,
        message: "请修正提交内容。",
      });
    },
  );

  it("treats a duplicate response as an already-listed confirmation after an uncertain retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: false,
      code: "DUPLICATE_SUBMISSION",
      error: "相同比赛已在待审核或已发布列表中。",
    }, { status: 409 }));

    await expect(requestMatchSubmission(payload, fetcher)).resolves.toEqual({
      ok: true,
      alreadyListed: true,
      message: SUBMISSION_ALREADY_LISTED_MESSAGE,
    });
  });

  it("does not treat an unrelated 409 response as an already-listed confirmation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: false,
      error: "Conflict",
    }, { status: 409 }));

    await expect(requestMatchSubmission(payload, fetcher)).resolves.toEqual({
      ok: false,
      message: "Conflict",
    });
  });

  it("does not expose a server error response body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: false,
      error: "private database host and stack details",
    }, { status: 500 }));

    await expect(requestMatchSubmission(payload, fetcher)).resolves.toEqual({
      ok: false,
      message: SUBMISSION_REQUEST_ERROR,
    });
  });

  it.each([
    {},
    { ok: true },
    { ok: true, status: "approved", message: "wrong state" },
    { ok: true, status: "pending", message: "" },
    { ...receipt, id: "not-a-uuid" },
    { ...receipt, submittedAt: "not-a-date" },
  ])("rejects a malformed successful response without claiming success", async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(requestMatchSubmission(payload, fetcher)).resolves.toEqual({
      ok: false,
      message: SUBMISSION_REQUEST_ERROR,
    });
  });

  it("accepts the intentional honeypot receipt without exposing an id", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: true,
      status: "pending",
      message: "已保存为待审核。",
    }, { status: 201 }));

    await expect(requestMatchSubmission(payload, fetcher)).resolves.toEqual({
      ok: true,
      message: "已保存为待审核。",
    });
  });

  it("does not display an unbounded client error message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ok: false,
      error: "x".repeat(201),
    }, { status: 400 }));

    await expect(requestMatchSubmission(payload, fetcher)).resolves.toEqual({
      ok: false,
      message: SUBMISSION_REQUEST_ERROR,
    });
  });

  it("rejects non-JSON and malformed JSON responses", async () => {
    const html = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>failure</html>", {
      headers: { "Content-Type": "text/html" },
    }));
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response("{", {
      headers: { "Content-Type": "application/json" },
    }));

    await expect(requestMatchSubmission(payload, html)).resolves.toEqual({
      ok: false,
      message: SUBMISSION_REQUEST_ERROR,
    });
    await expect(requestMatchSubmission(payload, malformed)).resolves.toEqual({
      ok: false,
      message: SUBMISSION_REQUEST_ERROR,
    });
  });

  it("rejects JSON-like media types that are not application/json", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(receipt, {
      status: 201,
      headers: { "Content-Type": "application/jsonp" },
    }));

    await expect(requestMatchSubmission(payload, fetcher)).resolves.toEqual({
      ok: false,
      message: SUBMISSION_REQUEST_ERROR,
    });
  });

  it("sanitizes network failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private network details"));
    await expect(requestMatchSubmission(payload, fetcher)).resolves.toEqual({
      ok: false,
      message: SUBMISSION_REQUEST_ERROR,
    });
  });

  it("aborts a stalled request and releases its deadline timer", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));

    const result = requestMatchSubmission(payload, fetcher);
    await vi.advanceTimersByTimeAsync(SUBMISSION_REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toEqual({
      ok: false,
      message: SUBMISSION_REQUEST_TIMEOUT_ERROR,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a timeout when the response body stalls after headers arrive", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
        },
      });
      init?.signal?.addEventListener("abort", () => {
        bodyController?.error(new DOMException("Aborted", "AbortError"));
      }, { once: true });

      return new Response(body, {
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = requestMatchSubmission(payload, fetcher);
    await vi.advanceTimersByTimeAsync(SUBMISSION_REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toEqual({
      ok: false,
      message: SUBMISSION_REQUEST_TIMEOUT_ERROR,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its deadline immediately after success", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(receipt));
    await requestMatchSubmission(payload, fetcher);
    expect(vi.getTimerCount()).toBe(0);
  });
});
