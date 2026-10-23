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
});
