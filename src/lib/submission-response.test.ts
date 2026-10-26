import { describe, expect, it } from "vitest";
import {
  readSubmissionResult,
  postPublicSubmission,
  SUBMISSION_UNAVAILABLE_MESSAGE,
  SUBMISSION_TIMEOUT_MESSAGE,
  submissionErrorMessage,
} from "./submission-response";

describe("public submission response handling", () => {
  it("returns the success message from a valid JSON response", async () => {
    const response = new Response(JSON.stringify({ ok: true, message: "已进入待审核。" }), {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

    await expect(readSubmissionResult(response)).resolves.toEqual({ message: "已进入待审核。" });
  });

  it("preserves a safe structured API error", async () => {
    const response = new Response(JSON.stringify({ ok: false, error: "提交过于频繁，请稍后重试。" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });

    await expect(readSubmissionResult(response)).rejects.toThrow("提交过于频繁，请稍后重试。");
  });

  it("uses a friendly retry message instead of exposing a gateway HTML parser error", async () => {
    const response = new Response("<!doctype html><title>Bad Gateway</title>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });

    await expect(readSubmissionResult(response)).rejects.toThrow(SUBMISSION_UNAVAILABLE_MESSAGE);
  });

  it("uses a friendly retry message for malformed JSON", async () => {
    const response = new Response("{bad json", {
      status: 502,
      headers: { "content-type": "application/json" },
    });

    await expect(readSubmissionResult(response)).rejects.toThrow(SUBMISSION_UNAVAILABLE_MESSAGE);
  });

  it("rejects structurally invalid responses and sanitizes transport/parser exceptions", async () => {
    const response = new Response(JSON.stringify({ detail: "internal stack" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

    await expect(readSubmissionResult(response)).rejects.toThrow(SUBMISSION_UNAVAILABLE_MESSAGE);
    expect(submissionErrorMessage(new SyntaxError("Unexpected token <"))).toBe(SUBMISSION_UNAVAILABLE_MESSAGE);
    expect(submissionErrorMessage(new TypeError("fetch failed: internal host"))).toBe(SUBMISSION_UNAVAILABLE_MESSAGE);
  });

  it("aborts a submission that stalls before response headers", async () => {
    const fetcher: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("request aborted", "AbortError")),
        { once: true },
      );
    });

    await expect(postPublicSubmission({ game: "lol" }, fetcher, 10))
      .rejects.toMatchObject({ message: SUBMISSION_TIMEOUT_MESSAGE });
  });

  it("bounds response-body parsing and explains that a timed-out submission may have arrived", async () => {
    const fetcher: typeof fetch = async (_input, init) => new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener(
          "abort",
          () => controller.error(new DOMException("response body aborted", "AbortError")),
          { once: true },
        );
      },
    }), { headers: { "content-type": "application/json" } });

    await expect(postPublicSubmission({ game: "lol" }, fetcher, 10))
      .rejects.toMatchObject({ message: SUBMISSION_TIMEOUT_MESSAGE });
  });
});
