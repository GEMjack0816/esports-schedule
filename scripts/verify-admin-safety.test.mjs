import { describe, expect, it } from "vitest";
import {
  assertAdminVerificationDeployment,
  parseAdminVerificationTarget,
} from "./verify-admin-safety.mjs";

const sha = "a".repeat(40);
const target = () => parseAdminVerificationTarget([
  "https://branch-preview.example.vercel.app",
  "codex/issue9-verify-admin-preview-guard",
  sha,
  "branch-preview.example.vercel.app,exact-preview.example.vercel.app",
]);

describe("verify:admin deployment safety", () => {
  it("requires an explicit allowlisted HTTPS Preview origin and exact ref/SHA", () => {
    expect(target()).toMatchObject({
      baseUrl: "https://branch-preview.example.vercel.app",
      expectedRef: "codex/issue9-verify-admin-preview-guard",
      expectedSha: sha,
    });
    expect(() => parseAdminVerificationTarget([
      "https://unlisted.example.vercel.app", "feature", sha, "allowed.example.vercel.app",
    ])).toThrow(/allowlist/);
    expect(() => parseAdminVerificationTarget([
      "http://branch-preview.example.vercel.app", "feature", sha, "branch-preview.example.vercel.app",
    ])).toThrow(/HTTPS/);
    expect(() => parseAdminVerificationTarget([
      "https://branch-preview.example.vercel.app", "main", sha, "branch-preview.example.vercel.app",
    ])).toThrow(/Preview branch/);
  });

  it.each([
    [{ environment: "production" }, "Production is rejected regardless of hostname"],
    [{ environment: "preview", gitCommitRef: "other", gitCommitSha: sha, deploymentId: "dpl_1", deploymentUrl: "https://exact-preview.example.vercel.app" }, "a mismatched ref is rejected"],
    [{ environment: "preview", gitCommitRef: "codex/issue9-verify-admin-preview-guard", gitCommitSha: "b".repeat(40), deploymentId: "dpl_1", deploymentUrl: "https://exact-preview.example.vercel.app" }, "a mismatched SHA is rejected"],
    [{ environment: "preview", gitCommitRef: "codex/issue9-verify-admin-preview-guard", gitCommitSha: sha, deploymentId: "dpl_1", deploymentUrl: "https://unlisted.example.vercel.app" }, "an unlisted resolved deployment hostname is rejected"],
    [{ environment: "preview", gitCommitRef: "codex/issue9-verify-admin-preview-guard", gitCommitSha: sha, deploymentUrl: "https://exact-preview.example.vercel.app" }, "missing deployment metadata is rejected"],
  ])("fails closed when %s", (metadata) => {
    expect(() => assertAdminVerificationDeployment(metadata, target())).toThrow();
  });

  it("accepts only a matching Preview environment, branch, SHA and deployment allowlist", () => {
    expect(() => assertAdminVerificationDeployment({
      service: "esports-schedule",
      environment: "preview",
      gitCommitRef: "codex/issue9-verify-admin-preview-guard",
      gitCommitSha: sha.toUpperCase(),
      deploymentId: "dpl_preview",
      deploymentUrl: "https://exact-preview.example.vercel.app",
    }, target())).not.toThrow();
  });
});
