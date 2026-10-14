import { describe, expect, it } from "vitest";
import {
  assertAdminVerifyDeployment,
  parseAdminVerifyConfiguration,
} from "./verify-admin-safety.mjs";

const origin = "https://esports-schedule-preview.vercel.app";
const sha = "a".repeat(40);
const expected = parseAdminVerifyConfiguration({
  baseUrl: origin,
  allowlistedOrigins: origin,
  expectedGitRef: "integration/review-reliability-validation",
  expectedGitSha: sha,
});
const deployment = {
  service: "esports-schedule",
  environment: "preview",
  gitCommitRef: expected.expectedGitRef,
  gitCommitSha: sha,
  deploymentId: "dpl_preview",
  deploymentUrl: origin,
};

describe("verify:admin target safety", () => {
  it("requires an exact HTTPS Preview origin allowlist", () => {
    expect(expected.origin).toBe(origin);
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: "https://production.example.com",
      allowlistedOrigins: origin,
      expectedGitRef: "feature/test",
      expectedGitSha: sha,
    })).toThrow(/not in .*ALLOWLIST|not in VERIFY_ADMIN_ALLOWED_PREVIEW_ORIGINS/i);
  });

  it.each([
    "http://esports-schedule-preview.vercel.app",
    "https://user:password@esports-schedule-preview.vercel.app",
    "https://esports-schedule-preview.vercel.app/path",
    "https://esports-schedule-preview.vercel.app?bypass=1",
  ])("rejects unsafe base URL %s", (baseUrl) => {
    expect(() => parseAdminVerifyConfiguration({
      baseUrl,
      allowlistedOrigins: origin,
      expectedGitRef: "feature/test",
      expectedGitSha: sha,
    })).toThrow();
  });

  it("requires a full expected commit SHA and Git ref", () => {
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: origin,
      expectedGitRef: "",
      expectedGitSha: sha,
    })).toThrow(/GIT_REF/);
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: origin,
      expectedGitRef: "feature/test",
      expectedGitSha: "short-sha",
    })).toThrow(/full 40-character/);
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: origin,
      expectedGitRef: 7,
      expectedGitSha: sha,
    })).toThrow(/GIT_REF/);
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: origin,
      expectedGitRef: "feature/test",
      expectedGitSha: 7,
    })).toThrow(/full 40-character/);
  });

  it("requires both branch and deployment origins in the Preview allowlist", () => {
    const deploymentOrigin = "https://esports-schedule-unique-deployment.vercel.app";
    const branchTarget = parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: `${origin},${deploymentOrigin}`,
      expectedGitRef: expected.expectedGitRef,
      expectedGitSha: sha,
    });

    expect(assertAdminVerifyDeployment({
      ...deployment,
      deploymentUrl: deploymentOrigin,
    }, branchTarget).deploymentId).toBe("dpl_preview");
    expect(() => assertAdminVerifyDeployment({
      ...deployment,
      deploymentUrl: deploymentOrigin,
    }, expected)).toThrow(/not in VERIFY_ADMIN_ALLOWED_PREVIEW_ORIGINS/);
  });

  it("accepts only matching Preview environment, deployment URL, ref and SHA", () => {
    expect(assertAdminVerifyDeployment(deployment, expected)).toEqual({
      deploymentId: "dpl_preview",
      gitCommitRef: expected.expectedGitRef,
      gitCommitSha: sha,
    });
  });

  it.each([
    [{ ...deployment, environment: "production" }, /environment=preview/],
    [{ ...deployment, gitCommitRef: "main" }, /GIT_REF/],
    [{ ...deployment, gitCommitSha: "b".repeat(40) }, /GIT_SHA/],
    [{ ...deployment, deploymentUrl: "https://other-preview.vercel.app" }, /not in VERIFY_ADMIN_ALLOWED_PREVIEW_ORIGINS/],
    [{ ...deployment, deploymentId: null }, /deployment ID/],
  ])("fails closed when deployment metadata does not match", (value, message) => {
    expect(() => assertAdminVerifyDeployment(value, expected)).toThrow(message);
  });
});
