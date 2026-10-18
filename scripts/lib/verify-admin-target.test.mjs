import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertIsolatedPreviewTarget,
  parseAllowedPreviewHosts,
  parsePreviewBaseUrl,
} from "./verify-admin-target.mjs";

const version = {
  service: "esports-schedule",
  environment: "preview",
  gitCommitSha: "a".repeat(40),
  gitCommitRef: "fix/safe-preview",
  deploymentId: "dpl_preview123",
  deploymentUrl: "https://deployment.vercel.app",
};

it("accepts only an explicitly allowlisted Preview at the expected ref and SHA", () => {
  expect(parsePreviewBaseUrl(
    "https://preview.example.vercel.app",
    parseAllowedPreviewHosts("preview.example.vercel.app"),
  ).origin).toBe("https://preview.example.vercel.app");
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
  expect(() => parseAllowedPreviewHosts("esports-schedule-two.vercel.app")).toThrow();
});

it.each([
  ["non-allowlisted host", "https://evil.vercel.app", "preview.example.vercel.app"],
  ["Production host", "https://esports-schedule-two.vercel.app", "esports-schedule-two.vercel.app"],
  ["non-HTTPS target", "http://preview.example.vercel.app", "preview.example.vercel.app"],
  ["nonstandard port", "https://preview.example.vercel.app:8443", "preview.example.vercel.app"],
  ["target path", "https://preview.example.vercel.app/admin", "preview.example.vercel.app"],
])("rejects %s during preflight before any authenticated request", (_label, baseUrl, allowlist) => {
  const allowedHosts = new Set([allowlist]);
  expect(() => parsePreviewBaseUrl(baseUrl, allowedHosts)).toThrow();
});

it("rejects an unallowlisted target before the verifier checks authenticated browser state", () => {
  const verifierPath = fileURLToPath(new URL("../verify-admin.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [
    verifierPath,
    "https://not-allowlisted.example",
    "a".repeat(40),
    "fix/isolated-preview",
    "dpl_preview123",
  ], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS: "preview.example.vercel.app",
      ALLOW_ISOLATED_ADMIN_VERIFY: "1",
      ADMIN_STORAGE_STATE: "C:\\nonexistent\\must-not-be-read.json",
    },
  });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Target host is not in ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS.");
  expect(result.stderr).not.toContain("ADMIN_STORAGE_STATE must point to an authenticated");
});
