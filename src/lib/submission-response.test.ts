import { describe, expect, it } from "vitest";
import {
  readSubmissionResult,
  SUBMISSION_UNAVAILABLE_MESSAGE,
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
});
