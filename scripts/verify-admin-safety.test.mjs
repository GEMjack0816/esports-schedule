import { describe, expect, it } from "vitest";
import {
  assertAdminSessionLanding,
  createPreviewCleanupRequest,
  assertIsolatedDatabasePreflight,
  assertPreviewDeployment,
  parseVerificationTarget,
} from "./verify-admin-safety.mjs";

const sha = "a".repeat(40);
const ref = "safety/verify-admin-preview-target";
const allowedHosts = ["preview.example.vercel.app", "deployment.example.vercel.app"];

function target(overrides = {}) {
  return parseVerificationTarget({
    baseUrl: "https://preview.example.vercel.app",
    expectedSha: sha,
    expectedRef: ref,
    allowedHosts,
    ...overrides,
  });
}

function version(overrides = {}) {
  return {
    service: "esports-schedule",
    environment: "preview",
    gitCommitSha: sha,
    gitCommitRef: ref,
    deploymentId: "dpl_preview",
    deploymentUrl: "https://deployment.example.vercel.app",
    ...overrides,
  };
}

describe("verify:admin fail-closed target guard", () => {
  it("accepts only the exact allowlisted HTTPS Preview host", () => {
    expect(target().baseUrl).toBe("https://preview.example.vercel.app");
  });

  it.each([
    "https://esports-schedule-two.vercel.app",
    "http://preview.example.vercel.app",
    "https://preview.example.vercel.app.attacker.test",
    "https://user:password@preview.example.vercel.app",
    "https://preview.example.vercel.app:8443",
  ])("rejects unsafe or non-allowlisted URL %s", (baseUrl) => {
    expect(() => target({ baseUrl })).toThrow();
  });

  it("requires explicit expected branch and full commit SHA", () => {
    expect(() => target({ expectedSha: "abc" })).toThrow();
    expect(() => target({ expectedRef: "../main" })).toThrow();
    expect(() => target({ expectedRef: "main" })).toThrow();
    expect(() => target({ allowedHosts: [] })).toThrow();
    expect(target({ expectedRef: "another-preview-branch" }).expectedRef).toBe("another-preview-branch");
  });

  it("accepts only version metadata matching Preview, ref, SHA, and allowlisted deployment URL", () => {
    const verified = assertPreviewDeployment(target(), version());
    expect(verified.gitCommitSha).toBe(sha);
    expect(verified.deploymentUrl).toBe("https://deployment.example.vercel.app");
    expect(verified.deploymentUrl).not.toBe(target().baseUrl);
  });

  it.each([
    { environment: "production" },
    { gitCommitSha: "b".repeat(40) },
    { gitCommitRef: "main" },
    { deploymentUrl: "https://unknown.vercel.app" },
    { deploymentId: null },
  ])("rejects mismatched or incomplete deployment metadata", (override) => {
    expect(() => assertPreviewDeployment(target(), version(override))).toThrow();
  });
});

describe("verify:admin cleanup target", () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const verifiedDeployment = {
    deploymentId: "dpl_preview",
    deploymentUrl: "https://deployment.example.vercel.app",
    gitCommitSha: sha,
    gitCommitRef: ref,
  };

  it("targets cleanup at the immutable deployment URL, not the mutable branch alias", () => {
    expect(createPreviewCleanupRequest(verifiedDeployment, runId)).toEqual({
      url: "https://deployment.example.vercel.app/api/admin/e2e-cleanup",
      options: {
        headers: { Origin: "https://deployment.example.vercel.app" },
        data: { runId },
        timeout: 15_000,
      },
    });
  });

  it.each([
    { ...verifiedDeployment, deploymentUrl: "http://deployment.example.vercel.app" },
    { ...verifiedDeployment, deploymentUrl: "https://user:password@deployment.example.vercel.app" },
    { ...verifiedDeployment, deploymentUrl: "https://deployment.example.vercel.app:8443" },
    { ...verifiedDeployment, deploymentUrl: "https://deployment.example.vercel.app/path" },
  ])("rejects an invalid immutable cleanup URL", (deployment) => {
    expect(() => createPreviewCleanupRequest(deployment, runId)).toThrow();
  });

  it("rejects a malformed cleanup run id", () => {
    expect(() => createPreviewCleanupRequest(verifiedDeployment, "not-a-uuid")).toThrow();
  });
});

describe("verify:admin session guard", () => {
  it("accepts the authenticated admin dashboard before any test write", () => {
    expect(() => assertAdminSessionLanding({
      status: 200,
      url: "https://preview.example.vercel.app/admin",
      baseUrl: "https://preview.example.vercel.app",
      bodyText: "审核概览 待审核 最近操作",
    })).not.toThrow();
  });

  it.each([
    { status: 200, url: "https://preview.example.vercel.app/admin/login", bodyText: "审核概览" },
    { status: 302, url: "https://preview.example.vercel.app/admin", bodyText: "审核概览" },
    { status: 200, url: "https://other.example.vercel.app/admin", bodyText: "审核概览" },
    { status: 200, url: "https://preview.example.vercel.app/admin", bodyText: "管理员 OAuth 尚未配置" },
  ])("rejects missing or mismatched admin sessions before test writes", (result) => {
    expect(() => assertAdminSessionLanding({
      ...result,
      baseUrl: "https://preview.example.vercel.app",
    })).toThrow(/no test data was written/i);
  });
});

describe("verify:admin isolated database preflight", () => {
  it("allows writes only after the server confirms an isolated Preview database", () => {
    expect(() => assertIsolatedDatabasePreflight({ status: 200, payload: { ok: true } })).not.toThrow();
  });

  it.each([
    { status: 404, payload: { error: "Not found" } },
    { status: 503, payload: { error: "Unavailable" } },
    { status: 200, payload: { ok: false } },
    { status: 200, payload: null },
  ])("fails closed before writes for any unverified database target", (result) => {
    expect(() => assertIsolatedDatabasePreflight(result)).toThrow(/no test data was written/i);
  });
});

