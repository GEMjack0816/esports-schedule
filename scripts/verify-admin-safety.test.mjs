import { describe, expect, it } from "vitest";
import { assertPreviewDeployment, parseVerificationTarget } from "./verify-admin-safety.mjs";

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
    expect(assertPreviewDeployment(target(), version()).gitCommitSha).toBe(sha);
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
