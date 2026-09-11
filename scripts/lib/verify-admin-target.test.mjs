import { describe, expect, it } from "vitest";
import { assertIsolatedPreviewTarget, parseAllowedPreviewHosts } from "./verify-admin-target.mjs";

const version = {
  service: "esports-schedule",
  environment: "preview",
  gitCommitSha: "abc123",
  gitCommitRef: "fix/safe-preview",
  deploymentId: "dpl_preview",
  deploymentUrl: "https://deployment.vercel.app",
};

it("accepts only an explicitly allowlisted Preview at the expected ref and SHA", () => {
  expect(() => assertIsolatedPreviewTarget({
    baseUrl: "https://preview.example.vercel.app",
    expectedSha: "abc123",
    expectedRef: "fix/safe-preview",
    allowedHosts: parseAllowedPreviewHosts("preview.example.vercel.app"),
    version,
  })).not.toThrow();
});

describe.each([
  ["non-allowlisted host", { baseUrl: "https://other.vercel.app" }],
  ["Production environment", { version: { ...version, environment: "production" } }],
  ["wrong SHA", { expectedSha: "wrong" }],
  ["wrong ref", { expectedRef: "main" }],
  ["missing deployment metadata", { version: { ...version, deploymentId: null } }],
])("rejects %s", (_label, override) => {
  it("fails closed", () => {
    expect(() => assertIsolatedPreviewTarget({
      baseUrl: "https://preview.example.vercel.app",
      expectedSha: "abc123",
      expectedRef: "fix/safe-preview",
      allowedHosts: new Set(["preview.example.vercel.app"]),
      version,
      ...override,
    })).toThrow();
  });
});
