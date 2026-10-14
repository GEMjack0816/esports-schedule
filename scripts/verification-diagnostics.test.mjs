import { describe, expect, it } from "vitest";
import { safeRequestPath, summarizeBrowserDiagnostic, summarizeRequestFailure } from "./verification-diagnostics.mjs";

const sensitiveValue = "access_token=hidden-token&client_secret=hidden-secret";

describe("verification diagnostic redaction", () => {
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
