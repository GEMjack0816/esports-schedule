import { describe, expect, it } from "vitest";
import { sanitizePublicStreamUrl, sanitizePublicStreams } from "./stream-url";

describe("public stream URL sanitization", () => {
  it.each([
    "https://stream.example/live?access_token=private",
    "https://stream.example/live?API-Key=private",
    "https://stream.example/live?foo=1#client_secret=private",
    "https://viewer:password@stream.example/live",
    "http://stream.example/live",
    "not a URL",
  ])("rejects credentialed or non-public URL %s", (value) => {
    expect(sanitizePublicStreamUrl(value)).toBeNull();
  });

  it("keeps ordinary public stream links and harmless query parameters", () => {
    expect(sanitizePublicStreamUrl("https://www.youtube.com/watch?v=abc&t=30s"))
      .toBe("https://www.youtube.com/watch?v=abc&t=30s");
  });

  it("removes unsafe URLs without dropping safe stream entries", () => {
    expect(sanitizePublicStreams([
      { label: "unsafe", url: "https://stream.example/live?token=secret" },
      { label: "safe", url: "https://stream.example/live", official: true },
    ])).toEqual([{ label: "safe", url: "https://stream.example/live", official: true }]);
  });
});
