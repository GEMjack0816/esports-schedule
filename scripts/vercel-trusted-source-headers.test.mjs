import { describe, expect, it } from "vitest";
import {
  addTrustedSourceHeader,
  getTrustedVercelDeploymentOrigin,
  isolateBrowserEnvironment,
  redactTrustedSourceToken,
  VERCEL_TRUSTED_SOURCE_HEADER,
} from "./vercel-trusted-source-headers.mjs";

describe("addTrustedSourceHeader", () => {
  it("adds the token for the exact deployment origin", () => {
    expect(addTrustedSourceHeader(
      { accept: "text/html" },
      "https://preview.example.vercel.app/api/version",
      "https://preview.example.vercel.app",
      "ephemeral-token",
    )).toEqual({
      accept: "text/html",
      [VERCEL_TRUSTED_SOURCE_HEADER]: "ephemeral-token",
    });
  });

  it("does not send the token to another origin", () => {
    const headers = { accept: "image/avif" };
    expect(addTrustedSourceHeader(
      headers,
      "https://images.example-cdn.com/logo.png",
      "https://preview.example.vercel.app",
      "ephemeral-token",
    )).toBe(headers);
  });

  it("leaves requests unchanged when no token is provided", () => {
    const headers = { accept: "application/json" };
    expect(addTrustedSourceHeader(
      headers,
      "https://preview.example.vercel.app/api/health",
      "https://preview.example.vercel.app",
      undefined,
    )).toBe(headers);
  });

  it("redacts every token occurrence from diagnostic text", () => {
    expect(redactTrustedSourceToken("header=short-token again=short-token", "short-token"))
      .toBe("header=[redacted] again=[redacted]");
  });

  it("passes only non-sensitive platform variables to the browser process", () => {
    expect(isolateBrowserEnvironment({
      PATH: "safe-path",
      SYSTEMROOT: "windows-root",
      VERCEL_OIDC_TOKEN: "short-lived-token",
      PANDASCORE_TOKEN: "provider-secret",
      DATABASE_URL: "db-credential",
    })).toEqual({ PATH: "safe-path", SYSTEMROOT: "windows-root" });
  });
});

describe("getTrustedVercelDeploymentOrigin", () => {
  it("accepts HTTPS Vercel deployment hostnames and returns only the origin", () => {
    expect(getTrustedVercelDeploymentOrigin(
      "https://esports-schedule-git-fix-deferred-sc-cafd17-jack-zhu-s-projects.vercel.app/api/version",
    )).toBe("https://esports-schedule-git-fix-deferred-sc-cafd17-jack-zhu-s-projects.vercel.app");
  });

  it.each([
    "https://attacker.example/path",
    "https://vercel.app/",
    "https://other-app-git-main-jack-zhu-s-projects.vercel.app/",
    "https://esports-schedule-git-branch-other-team.vercel.app/",
    "http://preview.vercel.app/",
    "https://preview.vercel.app.attacker.example/",
    "https://user:password@preview.vercel.app/",
    "https://preview.vercel.app:8443/",
    "not a URL",
  ])("rejects non-deployment or unsafe target %s", (value) => {
    expect(getTrustedVercelDeploymentOrigin(value)).toBeNull();
  });
});
