import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import {
  EXPECTED_SECURITY_HEADERS,
  getSecurityHeaderFailures,
} from "../../scripts/lib/security-response-headers.mjs";

describe("global response security headers", () => {
  it("applies conservative browser security headers to every route", async () => {
    const rules = await nextConfig.headers?.();
    const rule = rules?.find((candidate) => candidate.source === "/:path*");

    expect(rule).toBeDefined();
    expect(Object.fromEntries(rule?.headers.map(({ key, value }) => [key, value]) ?? [])).toEqual({
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    expect(Object.fromEntries(rule?.headers.map(({ key, value }) => [key, value]) ?? []))
      .toEqual(EXPECTED_SECURITY_HEADERS);
  });

  it("accepts all expected response headers", () => {
    expect(getSecurityHeaderFailures(new Headers(EXPECTED_SECURITY_HEADERS))).toEqual([]);
  });

  it("reports missing and changed response headers by name only", () => {
    const headers = new Headers(EXPECTED_SECURITY_HEADERS);
    headers.delete("Permissions-Policy");
    headers.set("X-Frame-Options", "SAMEORIGIN");

    expect(getSecurityHeaderFailures(headers).sort()).toEqual([
      "Permissions-Policy",
      "X-Frame-Options",
    ]);
  });
});
