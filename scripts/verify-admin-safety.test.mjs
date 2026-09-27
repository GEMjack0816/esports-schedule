import { describe, expect, it, vi } from "vitest";
import {
  assertPreviewBaseUrl,
  assertPreviewDatabaseUrl,
  assertPreviewDeployment,
  cleanupVerifyAdminData,
  parseDeploymentAllowlist,
  parseHostnameAllowlist,
  runWithAdminVerifyCleanup,
} from "./verify-admin-safety.mjs";

const previewHosts = parseHostnameAllowlist(
  "schedule-branch.vercel.app, schedule-deployment.vercel.app",
  "PREVIEW_HOSTS",
);
const deploymentIds = parseDeploymentAllowlist("dpl_Preview123");
const validVersion = {
  service: "esports-schedule",
  environment: "preview",
  gitCommitRef: "integration/review-reliability-validation",
  gitCommitSha: "a".repeat(40),
  deploymentId: "dpl_Preview123",
  deploymentUrl: "https://schedule-deployment.vercel.app",
};

describe("verify:admin target safeguards", () => {
  it("accepts only an allowlisted Preview deployment with the expected branch and SHA", () => {
    expect(assertPreviewDeployment({
      baseUrl: "https://schedule-branch.vercel.app",
      version: validVersion,
      expectedRef: validVersion.gitCommitRef,
      expectedSha: validVersion.gitCommitSha,
      allowedHosts: previewHosts,
      allowedDeploymentIds: deploymentIds,
    })).toEqual({
      deploymentUrl: "https://schedule-deployment.vercel.app",
      deploymentId: "dpl_Preview123",
    });
  });

  it("rejects every Production deployment regardless of hostname", () => {
    expect(() => assertPreviewDeployment({
      baseUrl: "https://schedule-branch.vercel.app",
      version: { ...validVersion, environment: "production" },
      expectedRef: validVersion.gitCommitRef,
      expectedSha: validVersion.gitCommitSha,
      allowedHosts: previewHosts,
      allowedDeploymentIds: deploymentIds,
    })).toThrow("ADMIN_VERIFY_DEPLOYMENT_IDENTITY_MISMATCH");
  });

  it("requires an explicit non-main Preview ref and a full expected SHA", () => {
    expect(() => assertPreviewDeployment({
      baseUrl: "https://schedule-branch.vercel.app",
      version: validVersion,
      expectedRef: "main",
      expectedSha: validVersion.gitCommitSha,
      allowedHosts: previewHosts,
      allowedDeploymentIds: deploymentIds,
    })).toThrow("ADMIN_VERIFY_EXPECTED_REF_AND_SHA_REQUIRED");
  });

  it("rejects a Production alias even if it is mistakenly allowlisted", () => {
    const unsafeHosts = new Set([...previewHosts, "esports-schedule-two.vercel.app"]);
    expect(() => assertPreviewBaseUrl("https://esports-schedule-two.vercel.app", unsafeHosts))
      .toThrow("ADMIN_VERIFY_PREVIEW_HOST_NOT_ALLOWED");
  });

  it("fails closed for a wrong branch, SHA, or non-allowlisted deployment ID", () => {
    for (const patch of [
      { gitCommitRef: "main" },
      { gitCommitSha: "b".repeat(40) },
      { deploymentId: "dpl_Other" },
    ]) {
      expect(() => assertPreviewDeployment({
        baseUrl: "https://schedule-branch.vercel.app",
        version: { ...validVersion, ...patch },
        expectedRef: validVersion.gitCommitRef,
        expectedSha: validVersion.gitCommitSha,
        allowedHosts: previewHosts,
        allowedDeploymentIds: deploymentIds,
      })).toThrow("ADMIN_VERIFY_DEPLOYMENT_IDENTITY_MISMATCH");
    }
  });

  it("requires an exact HTTPS hostname allowlist and Preview database host", () => {
    expect(() => parseHostnameAllowlist("*.vercel.app", "PREVIEW_HOSTS"))
      .toThrow("ADMIN_VERIFY_INVALID_PREVIEW_HOSTS");
    expect(() => assertPreviewDatabaseUrl(
      "postgresql://user:password@production-db.example/db",
      new Set(["preview-db.example"]),
    )).toThrow("ADMIN_VERIFY_DATABASE_HOST_NOT_ALLOWED");
    expect(() => assertPreviewDatabaseUrl(
      "postgresql://user:password@preview-db.example/db",
      new Set(["preview-db.example"]),
    )).not.toThrow();
  });
});

describe("verify:admin cleanup", () => {
  it("deletes only marked submissions, their published matches, and related audit events in one transaction", async () => {
    const calls = [];
    const statement = (strings, ...values) => {
      const query = strings.join("?").replace(/\s+/g, " ").trim().toLowerCase();
      calls.push({ query, values });
      if (query.startsWith("select id from match_submissions")) return Promise.resolve([{ id: "submission-1" }]);
      if (query.startsWith("select id from published_manual_matches")) return Promise.resolve([{ id: "match-1" }]);
      return Promise.resolve([]);
    };
    statement.begin = async (callback) => callback(statement);

    await cleanupVerifyAdminData(statement, "Codex isolated review unique-run");

    expect(calls.map(({ query }) => query)).toEqual([
      "select id from match_submissions where league = ?",
      "select id from published_manual_matches where league = ? or league = ? or source_submission_id = any(?::uuid[])",
      "delete from admin_audit_events where entity_id = any(?::uuid[])",
      "delete from published_manual_matches where id = any(?::uuid[])",
      "delete from match_submissions where id = any(?::uuid[])",
    ]);
    expect(calls.every(({ values }) => values.length === 0 || values.every((value) =>
      Array.isArray(value) || value === "Codex isolated review unique-run" || value === "Codex isolated review unique-run edited" || value === "submission-1" || value === "match-1",
    ))).toBe(true);
  });

  it("always attempts cleanup after both successful and failed E2E runs", async () => {
    const successCleanup = vi.fn();
    await expect(runWithAdminVerifyCleanup(async () => "ok", successCleanup)).resolves.toBe("ok");
    expect(successCleanup).toHaveBeenCalledOnce();

    const failedCleanup = vi.fn();
    await expect(runWithAdminVerifyCleanup(async () => { throw new Error("private detail"); }, failedCleanup))
      .rejects.toThrow("ADMIN_VERIFY_RUN_FAILED_CLEANUP_SUCCEEDED");
    expect(failedCleanup).toHaveBeenCalledOnce();
  });

  it("reports cleanup failure without echoing underlying database details", async () => {
    await expect(runWithAdminVerifyCleanup(async () => "ok", async () => {
      throw new Error("sensitive connection detail");
    })).rejects.toThrow("ADMIN_VERIFY_CLEANUP_FAILED");
  });
});
