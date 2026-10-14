import { describe, expect, it } from "vitest";
import {
  normalizeVerifierBaseUrl,
  safeRequestPath,
  summarizeBrowserDiagnostic,
  summarizeRequestFailure,
} from "./verification-diagnostics.mjs";

const sensitiveValue = "access_token=hidden-token&client_secret=hidden-secret";

describe("verification diagnostic redaction", () => {
  it("accepts a plain HTTPS origin and local HTTP only when enabled", () => {
    expect(normalizeVerifierBaseUrl("https://preview.invalid/")).toBe("https://preview.invalid");
    expect(normalizeVerifierBaseUrl("http://localhost:3000")).toBeNull();
    expect(normalizeVerifierBaseUrl("http://localhost:3000", { allowLocalHttp: true })).toBe("http://localhost:3000");
    expect(normalizeVerifierBaseUrl("http://127.0.0.1:3000", { allowLocalHttp: true })).toBe("http://127.0.0.1:3000");
  });

  it.each([
    `https://user:${sensitiveValue}@preview.invalid/`,
    `https://preview.invalid/?${sensitiveValue}`,
    `https://preview.invalid/#${sensitiveValue}`,
    `https://preview.invalid/private/${sensitiveValue}`,
    "http://remote.invalid/",
    "javascript:alert(1)",
  ])("rejects verifier target URLs that are not safe origins", (value) => {
    expect(normalizeVerifierBaseUrl(value, { allowLocalHttp: true })).toBeNull();
  });

  it("keeps only an allowlisted request path and drops credentials and query data", () => {
    const path = safeRequestPath(`https://user:${sensitiveValue}@preview.invalid/api/matches?${sensitiveValue}#${sensitiveValue}`);

    expect(path).toBe("/api/matches");
    expect(path).not.toContain(sensitiveValue);
  });

  it("omits unknown paths and malformed URLs", () => {
    expect(safeRequestPath(`https://preview.invalid/private/${sensitiveValue}?${sensitiveValue}`)).toBe("[other path]");
    expect(safeRequestPath(sensitiveValue)).toBe("[invalid URL]");
  });

  it("summarizes failed requests without echoing URL parameters or arbitrary failure text", () => {
    const message = summarizeRequestFailure(
      "GET",
      `https://preview.invalid/api/version?${sensitiveValue}`,
      `net::ERR_FAILED ${sensitiveValue}`,
    );

    expect(message).toBe("GET /api/version failed");
    expect(message).not.toContain(sensitiveValue);
  });

  it("allows only fixed browser diagnostic descriptions", () => {
    const message = summarizeBrowserDiagnostic(`page:${sensitiveValue}`);

    expect(message).toBe("browser verification diagnostic");
    expect(message).not.toContain(sensitiveValue);
    expect(summarizeBrowserDiagnostic("page")).toBe("uncaught page error");
  });
});
