import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

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
  });
});
