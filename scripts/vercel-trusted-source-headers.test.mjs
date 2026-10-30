import { describe, expect, it, vi } from "vitest";
import {
  addTrustedSourceHeader,
  fetchTrustedSourceResponse,
  getTrustedVercelDeploymentOrigin,
  isolateBrowserEnvironment,
  MAX_TRUSTED_SOURCE_REDIRECTS,
  redactTrustedSourceToken,
  VERCEL_TRUSTED_SOURCE_HEADER,
  ESPORTS_SCHEDULE_VERCEL_PROJECT_ID,
  verifyTrustedVercelPreviewDeployment,
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
    const headers = { accept: "image/avif", [VERCEL_TRUSTED_SOURCE_HEADER]: "inherited-token" };
    expect(addTrustedSourceHeader(
      headers,
      "https://images.example-cdn.com/logo.png",
      "https://preview.example.vercel.app",
      "ephemeral-token",
    )).toEqual({ accept: "image/avif" });
  });

  it("leaves requests unchanged when no token is provided", () => {
    const headers = { accept: "application/json" };
    expect(addTrustedSourceHeader(
      headers,
      "https://preview.example.vercel.app/api/health",
      "https://preview.example.vercel.app",
      undefined,
    )).toEqual(headers);
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

describe("fetchTrustedSourceResponse", () => {
  const response = (status, headers = {}) => ({ status: () => status, headers: () => headers });

  it("manually authenticates each same-origin redirect hop without automatic redirect following", async () => {
    const responses = [response(302, { location: "/api/version" }), response(200)];
    const fetch = vi.fn(async () => responses.shift());
    const route = {
      request: () => ({
        url: () => "https://preview.example.vercel.app/",
        method: () => "GET",
        headers: () => ({ accept: "text/html" }),
      }),
      fetch,
    };

    const result = await fetchTrustedSourceResponse(
      route,
      "https://preview.example.vercel.app",
      "ephemeral-token",
    );

    expect(result.status()).toBe(200);
    expect(fetch).toHaveBeenNthCalledWith(1, {
      headers: { accept: "text/html", [VERCEL_TRUSTED_SOURCE_HEADER]: "ephemeral-token" },
      maxRedirects: 0,
    });
    expect(fetch).toHaveBeenNthCalledWith(2, {
      url: "https://preview.example.vercel.app/api/version",
      headers: { accept: "text/html", [VERCEL_TRUSTED_SOURCE_HEADER]: "ephemeral-token" },
      maxRedirects: 0,
    });
  });

  it("stops at a cross-origin redirect without fetching the destination", async () => {
    const redirect = response(302, { location: "https://attacker.example/collect" });
    const fetch = vi.fn(async () => redirect);
    const route = {
      request: () => ({
        url: () => "https://preview.example.vercel.app/",
        method: () => "GET",
        headers: () => ({ accept: "text/html" }),
      }),
      fetch,
    };

    const result = await fetchTrustedSourceResponse(
      route,
      "https://preview.example.vercel.app",
      "ephemeral-token",
    );

    expect(result).toBe(redirect);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0].maxRedirects).toBe(0);
    expect(fetch.mock.calls[0][0].headers[VERCEL_TRUSTED_SOURCE_HEADER]).toBe("ephemeral-token");
  });

  it("bounds same-origin redirect loops", async () => {
    const fetch = vi.fn(async () => response(302, { location: "/loop" }));
    const route = {
      request: () => ({
        url: () => "https://preview.example.vercel.app/",
        method: () => "GET",
        headers: () => ({ accept: "text/html" }),
      }),
      fetch,
    };

    const result = await fetchTrustedSourceResponse(
      route,
      "https://preview.example.vercel.app",
      "ephemeral-token",
    );

    expect(result.status()).toBe(302);
    expect(fetch).toHaveBeenCalledTimes(MAX_TRUSTED_SOURCE_REDIRECTS + 1);
    expect(fetch.mock.calls.every(([options]) => options.maxRedirects === 0)).toBe(true);
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

describe("verifyTrustedVercelPreviewDeployment", () => {
  const validApiDeployment = {
    projectId: ESPORTS_SCHEDULE_VERCEL_PROJECT_ID,
    readyState: "READY",
  };
  const validInspection = {
    name: "esports-schedule",
    target: "preview",
    readyState: "READY",
  };

  it("requires exact project identity and a READY Preview target before returning an origin", () => {
    const runJson = vi.fn(([command]) => command === "api" ? validApiDeployment : validInspection);

    expect(verifyTrustedVercelPreviewDeployment(
      "https://esports-schedule-abc123456-jack-zhu-s-projects.vercel.app",
      runJson,
    )).toBe("https://esports-schedule-abc123456-jack-zhu-s-projects.vercel.app");
    expect(runJson).toHaveBeenNthCalledWith(1, expect.arrayContaining([
      "api",
      "/v13/deployments/esports-schedule-abc123456-jack-zhu-s-projects.vercel.app",
      "--raw",
    ]));
    expect(runJson).toHaveBeenNthCalledWith(2, expect.arrayContaining([
      "inspect",
      "esports-schedule-abc123456-jack-zhu-s-projects.vercel.app",
      "--format=json",
    ]));
  });

  it("rejects a similarly named deployment owned by another Vercel project", () => {
    const runJson = vi.fn(([command]) => command === "api"
      ? { ...validApiDeployment, projectId: "prj_unrelated_project" }
      : validInspection);

    expect(() => verifyTrustedVercelPreviewDeployment(
      "https://esports-schedule-other-app-abc123456-jack-zhu-s-projects.vercel.app",
      runJson,
    )).toThrow(/not this project's READY Preview deployment/);
  });

  it.each([
    { ...validInspection, target: "production" },
    { ...validInspection, readyState: "BUILDING" },
    { ...validInspection, name: "esports-schedule-other" },
  ])("rejects a target that is not the READY esports-schedule Preview", (inspection) => {
    const runJson = vi.fn(([command]) => command === "api" ? validApiDeployment : inspection);

    expect(() => verifyTrustedVercelPreviewDeployment(
      "https://esports-schedule-abc123456-jack-zhu-s-projects.vercel.app",
      runJson,
    )).toThrow(/not this project's READY Preview deployment/);
  });

  it("does not make Vercel API calls for a non-project hostname", () => {
    const runJson = vi.fn();

    expect(() => verifyTrustedVercelPreviewDeployment("https://attacker.example", runJson))
      .toThrow(/only supports this project's HTTPS Vercel Preview/);
    expect(runJson).not.toHaveBeenCalled();
  });
});

