import { describe, expect, it } from "vitest";
import {
  assertAdminVerifyDatabaseTarget,
  assertAdminVerifyDeployment,
  assertAdminVerifySessionPreflight,
  buildVerificationRunMarkers,
  parseAdminVerifyConfiguration,
  summarizeAdminVerifyFailure,
} from "./verify-admin-safety.mjs";

const origin = "https://esports-schedule-preview.vercel.app";
const sha = "a".repeat(40);
const databaseFingerprint = "c".repeat(64);
const expected = parseAdminVerifyConfiguration({
  baseUrl: origin,
  allowlistedOrigins: origin,
  expectedGitRef: "integration/review-reliability-validation",
  expectedGitSha: sha,
  expectedDatabaseFingerprint: databaseFingerprint,
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
  it("redacts arbitrary verifier exception details while preserving a safe HTTP status", () => {
    const error = new Error("HTTP 503 access_token=do-not-log nonce=do-not-log https://preview.invalid/?secret=do-not-log");

    expect(summarizeAdminVerifyFailure(error, "verification"))
      .toBe("Admin verification failed (HTTP 503); details redacted.");
    expect(summarizeAdminVerifyFailure(error, "cleanup"))
      .toBe("Preview verification-data cleanup failed (HTTP 503); details redacted.");
  });

  it("does not echo non-Error rejection values", () => {
    expect(summarizeAdminVerifyFailure("client_secret=do-not-log", "verification"))
      .toBe("Admin verification failed; details redacted.");
  });

  it("keeps the cleanup UUID out of fields visible in the public schedule", () => {
    const runId = "eac53db6-16b4-4bd0-877a-e3ed5f4fe2b1";
    const fixtureLabel = "a461a971-dc11-4681-a290-c0bd058d3322";
    const markers = buildVerificationRunMarkers(runId, fixtureLabel);

    expect(markers.notes).toBe(`verify-admin:${runId}`);
    expect([
      markers.league,
      ...markers.approvedTeams,
      ...markers.rejectedTeams,
    ].join(" ")).not.toContain(runId);
    expect(() => buildVerificationRunMarkers(runId, runId)).toThrow(/distinct UUIDs/);
  });

  it("requires an exact HTTPS Preview origin allowlist", () => {
    expect(expected.origin).toBe(origin);
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: "https://production.example.com",
      allowlistedOrigins: origin,
      expectedGitRef: "feature/test",
      expectedGitSha: sha,
      expectedDatabaseFingerprint: databaseFingerprint,
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
      expectedDatabaseFingerprint: databaseFingerprint,
    })).toThrow();
  });

  it("requires a full expected commit SHA and Git ref", () => {
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: origin,
      expectedGitRef: "",
      expectedGitSha: sha,
      expectedDatabaseFingerprint: databaseFingerprint,
    })).toThrow(/GIT_REF/);
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: origin,
      expectedGitRef: "feature/test",
      expectedGitSha: "short-sha",
      expectedDatabaseFingerprint: databaseFingerprint,
    })).toThrow(/full 40-character/);
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: origin,
      expectedGitRef: 7,
      expectedGitSha: sha,
      expectedDatabaseFingerprint: databaseFingerprint,
    })).toThrow(/GIT_REF/);
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: origin,
      expectedGitRef: "feature/test",
      expectedGitSha: 7,
      expectedDatabaseFingerprint: databaseFingerprint,
    })).toThrow(/full 40-character/);
  });

  it("requires both branch and deployment origins in the Preview allowlist", () => {
    const deploymentOrigin = "https://esports-schedule-unique-deployment.vercel.app";
    const branchTarget = parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: `${origin},${deploymentOrigin}`,
      expectedGitRef: expected.expectedGitRef,
      expectedGitSha: sha,
      expectedDatabaseFingerprint: databaseFingerprint,
    });

    const verified = assertAdminVerifyDeployment({
      ...deployment,
      deploymentUrl: deploymentOrigin,
    }, branchTarget);
    expect(verified).toMatchObject({ origin: deploymentOrigin, deploymentId: "dpl_preview" });
    expect(() => assertAdminVerifyDeployment({
      ...deployment,
      deploymentUrl: deploymentOrigin,
    }, expected)).toThrow(/not in VERIFY_ADMIN_ALLOWED_PREVIEW_ORIGINS/);
  });

  it("accepts only matching Preview environment, deployment URL, ref and SHA", () => {
    expect(assertAdminVerifyDeployment(deployment, expected)).toEqual({
      origin,
      deploymentId: "dpl_preview",
      gitCommitRef: expected.expectedGitRef,
      gitCommitSha: sha,
    });
  });

  it("requires a connected database with the expected fingerprint on the same deployment", () => {
    const health = {
      database: { status: "connected", targetFingerprint: databaseFingerprint },
      version: { deploymentId: "dpl_preview", gitCommitSha: sha },
    };
    expect(() => assertAdminVerifyDatabaseTarget(health, {
      expectedDatabaseFingerprint: databaseFingerprint,
      deploymentId: "dpl_preview",
      gitCommitSha: sha,
    })).not.toThrow();
  });

  it.each([
    [{ database: { status: "unavailable", targetFingerprint: databaseFingerprint }, version: { deploymentId: "dpl_preview", gitCommitSha: sha } }, /not connected/],
    [{ database: { status: "connected", targetFingerprint: null }, version: { deploymentId: "dpl_preview", gitCommitSha: sha } }, /identity is unavailable/],
    [{ database: { status: "connected", targetFingerprint: "d".repeat(64) }, version: { deploymentId: "dpl_preview", gitCommitSha: sha } }, /does not match/],
    [{ database: { status: "connected", targetFingerprint: databaseFingerprint }, version: { deploymentId: "dpl_other", gitCommitSha: sha } }, /does not match the verified deployment/],
  ])("fails closed before any verifier write for an untrusted Preview database", (health, message) => {
    expect(() => assertAdminVerifyDatabaseTarget(health, {
      expectedDatabaseFingerprint: databaseFingerprint,
      deploymentId: "dpl_preview",
      gitCommitSha: sha,
    })).toThrow(message);
  });

  it("requires a caller-supplied expected database fingerprint", () => {
    expect(() => parseAdminVerifyConfiguration({
      baseUrl: origin,
      allowlistedOrigins: origin,
      expectedGitRef: expected.expectedGitRef,
      expectedGitSha: sha,
      expectedDatabaseFingerprint: "not-a-fingerprint",
    })).toThrow(/VERIFY_ADMIN_EXPECTED_DATABASE_FINGERPRINT/);
  });

  it("requires an authenticated admin session on the immutable verified deployment before writes", () => {
    expect(() => assertAdminVerifySessionPreflight({
      status: 200,
      pageUrl: `${origin}/admin`,
      expectedOrigin: origin,
    })).not.toThrow();

    for (const invalid of [
      { status: 200, pageUrl: `${origin}/admin/login`, expectedOrigin: origin },
      { status: 200, pageUrl: "https://branch-alias.vercel.app/admin", expectedOrigin: origin },
      { status: 401, pageUrl: `${origin}/admin`, expectedOrigin: origin },
    ]) {
      expect(() => assertAdminVerifySessionPreflight(invalid)).toThrow(/no test data was written/);
    }
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
