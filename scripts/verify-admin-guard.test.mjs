import { describe, expect, it } from "vitest";
import { adminVerificationConfig, assertPreviewVersion } from "./verify-admin-guard.mjs";

const sha = "a".repeat(40);
const deploymentId = "dpl_preview123";
const host = "esports-schedule-git-fix-example.vercel.app";

function environment(overrides = {}) {
  return {
    ALLOW_ISOLATED_ADMIN_VERIFY: "1",
    ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS: host,
    ...overrides,
  };
}

describe("verify:admin Preview guard", () => {
  it("requires an exact allowlisted HTTPS origin and immutable Preview identity", () => {
    expect(adminVerificationConfig([
      `https://${host}`,
      "fix/safe-preview",
      sha,
      deploymentId,
    ], environment())).toEqual({
      baseUrl: `https://${host}`,
      expectedGitRef: "fix/safe-preview",
      expectedGitSha: sha,
      expectedDeploymentId: deploymentId,
    });
  });

  it.each([
    ["Production ref", [`https://${host}`, "main", sha, deploymentId], environment()],
    ["non-allowlisted host", ["https://another.vercel.app", "fix/safe", sha, deploymentId], environment()],
    ["wildcard allowlist", [`https://${host}`, "fix/safe", sha, deploymentId], environment({
      ADMIN_VERIFY_ALLOWED_PREVIEW_HOSTS: "*.vercel.app",
    })],
    ["non-HTTPS URL", [`http://${host}`, "fix/safe", sha, deploymentId], environment()],
    ["URL with a path", [`https://${host}/admin`, "fix/safe", sha, deploymentId], environment()],
    ["short SHA", [`https://${host}`, "fix/safe", "abc123", deploymentId], environment()],
    ["invalid deployment", [`https://${host}`, "fix/safe", sha, "preview"], environment()],
  ])("fails closed for %s", (_label, args, env) => {
    expect(() => adminVerificationConfig(args, env)).toThrow();
  });

  it("requires the explicit isolated-environment acknowledgement", () => {
    expect(() => adminVerificationConfig(
      [`https://${host}`, "fix/safe", sha, deploymentId],
      environment({ ALLOW_ISOLATED_ADMIN_VERIFY: "0" }),
    )).toThrow(/ALLOW_ISOLATED_ADMIN_VERIFY/);
  });

  it("accepts only exact Preview version metadata", () => {
    const config = adminVerificationConfig(
      [`https://${host}`, "fix/safe", sha, deploymentId],
      environment(),
    );
    expect(() => assertPreviewVersion({
      service: "esports-schedule",
      environment: "preview",
      gitCommitRef: "fix/safe",
      gitCommitSha: sha,
      deploymentId,
    }, config)).not.toThrow();
  });

  it.each([
    ["production environment", { environment: "production" }],
    ["wrong ref", { gitCommitRef: "fix/other" }],
    ["wrong SHA", { gitCommitSha: "b".repeat(40) }],
    ["wrong deployment", { deploymentId: "dpl_other" }],
    ["wrong service", { service: "other" }],
  ])("rejects %s before any mutation", (_label, override) => {
    const config = adminVerificationConfig(
      [`https://${host}`, "fix/safe", sha, deploymentId],
      environment(),
    );
    expect(() => assertPreviewVersion({
      service: "esports-schedule",
      environment: "preview",
      gitCommitRef: "fix/safe",
      gitCommitSha: sha,
      deploymentId,
      ...override,
    }, config)).toThrow();
  });
});
