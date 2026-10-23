import { describe, expect, it } from "vitest";
import { isAdminE2ECleanupEnabled } from "./e2e-cleanup-guard";

describe("admin E2E cleanup deployment guard", () => {
  it("enables cleanup on a non-main Preview branch", () => {
    expect(isAdminE2ECleanupEnabled({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "safety/verify-admin-preview-target",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      VERCEL_DEPLOYMENT_ID: "dpl_preview",
      VERCEL_URL: "preview.example.vercel.app",
      DATABASE_URL: "postgres://review:placeholder@preview-db.example.test/app_test",
      ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS: "preview-db.example.test",
    })).toBe(true);
  });

  it.each([
    {},
    {
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "safety/verify-admin-preview-target",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      VERCEL_DEPLOYMENT_ID: "dpl_preview",
      VERCEL_URL: "preview.example.vercel.app",
    },
    {
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      VERCEL_DEPLOYMENT_ID: "dpl_preview",
      VERCEL_URL: "preview.example.vercel.app",
    },
    {
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "safety/verify-admin-preview-target",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      VERCEL_DEPLOYMENT_ID: "dpl_preview",
    },
    {
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "safety/verify-admin-preview-target",
      VERCEL_DEPLOYMENT_ID: "dpl_preview",
      VERCEL_URL: "preview.example.vercel.app",
    },
    {
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "safety/verify-admin-preview-target",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      VERCEL_URL: "preview.example.vercel.app",
    },
    { VERCEL_ENV: undefined, VERCEL_GIT_COMMIT_REF: "safety/verify-admin-preview-target" },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: undefined },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "" },
  ])("fails closed for any other deployment identity", (environment) => {
    expect(isAdminE2ECleanupEnabled(environment)).toBe(false);
  });

  it.each([
    { DATABASE_URL: undefined },
    { ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS: undefined },
    { DATABASE_URL: "postgres://review:placeholder@production-db.example.test/app_test" },
    { ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS: "preview-db.example.test.attacker.test" },
    { DATABASE_URL: "https://preview-db.example.test/app_test" },
    { DATABASE_URL: "not-a-database-url" },
    { ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS: "preview-db.example.test,*.example.test" },
  ])("fails closed unless the runtime DB hostname exactly matches the Preview allowlist", (override) => {
    expect(isAdminE2ECleanupEnabled({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "safety/verify-admin-preview-target",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      VERCEL_DEPLOYMENT_ID: "dpl_preview",
      VERCEL_URL: "preview.example.vercel.app",
      DATABASE_URL: "postgres://review:placeholder@preview-db.example.test/app_test",
      ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS: "preview-db.example.test",
      ...override,
    })).toBe(false);
  });

  it("accepts a comma-separated exact allowlist for isolated Preview database endpoints", () => {
    expect(isAdminE2ECleanupEnabled({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "safety/verify-admin-preview-target",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      VERCEL_DEPLOYMENT_ID: "dpl_preview",
      VERCEL_URL: "preview.example.vercel.app",
      DATABASE_URL: "postgresql://review:placeholder@preview-db-2.example.test/app_test?sslmode=require",
      ADMIN_VERIFY_PREVIEW_DATABASE_HOSTS: "preview-db.example.test, preview-db-2.example.test",
    })).toBe(true);
  });
});
