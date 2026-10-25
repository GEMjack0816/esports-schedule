import { describe, expect, it } from "vitest";
import { assertIsolatedPreviewTarget, parseAllowedPreviewHosts } from "./verify-admin-target.mjs";

const version = {
  service: "esports-schedule",
  environment: "preview",
  gitCommitSha: "a".repeat(40),
  gitCommitRef: "fix/safe-preview",
  deploymentId: "dpl_preview123",
  deploymentUrl: "https://deployment.vercel.app",
};

it("accepts only an explicitly allowlisted Preview at the expected ref and SHA", () => {
  expect(() => assertIsolatedPreviewTarget({
    baseUrl: "https://preview.example.vercel.app",
    expectedSha: "a".repeat(40),
    expectedRef: "fix/safe-preview",
    expectedDeploymentId: "dpl_preview123",
    allowedHosts: parseAllowedPreviewHosts("preview.example.vercel.app"),
    version,
  })).not.toThrow();
});

describe.each([
  ["non-allowlisted host", { baseUrl: "https://other.vercel.app" }],
  ["non-HTTPS target", { baseUrl: "http://preview.example.vercel.app" }],
  ["target with a path", { baseUrl: "https://preview.example.vercel.app/admin" }],
  ["Production environment", { version: { ...version, environment: "production" } }],
  ["wrong SHA", { expectedSha: "wrong" }],
  ["Production ref", { expectedRef: "main" }],
  ["wrong deployment", { expectedDeploymentId: "dpl_other" }],
  ["missing deployment metadata", { version: { ...version, deploymentId: null } }],
])("rejects %s", (_label, override) => {
  it("fails closed", () => {
    expect(() => assertIsolatedPreviewTarget({
      baseUrl: "https://preview.example.vercel.app",
      expectedSha: "a".repeat(40),
      expectedRef: "fix/safe-preview",
      expectedDeploymentId: "dpl_preview123",
      allowedHosts: new Set(["preview.example.vercel.app"]),
      version,
      ...override,
    })).toThrow();
  });
});

it("rejects empty and wildcard host allowlists", () => {
  expect(() => parseAllowedPreviewHosts("")).toThrow();
  expect(() => parseAllowedPreviewHosts("*.vercel.app")).toThrow();
});
