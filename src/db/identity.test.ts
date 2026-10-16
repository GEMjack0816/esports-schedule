import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  fingerprintDatabaseTarget,
  getPreviewDatabaseTargetFingerprint,
} from "./identity";

const previewUrl = "postgresql://preview_user:preview_password@ep-preview-id.us-west-2.aws.neon.tech/neondb?sslmode=require&options=secret";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("database target fingerprint", () => {
  it("is stable across credentials and connection options", () => {
    const first = fingerprintDatabaseTarget(previewUrl);
    const second = fingerprintDatabaseTarget(
      "postgres://another_user:another_password@ep-preview-id.us-west-2.aws.neon.tech/neondb?sslmode=verify-full",
    );

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it("changes when the database host or database name changes", () => {
    const original = fingerprintDatabaseTarget(previewUrl);
    expect(fingerprintDatabaseTarget(
      "postgresql://u:p@ep-other-id.us-west-2.aws.neon.tech/neondb?sslmode=require",
    )).not.toBe(original);
    expect(fingerprintDatabaseTarget(
      "postgresql://u:p@ep-preview-id.us-west-2.aws.neon.tech/otherdb?sslmode=require",
    )).not.toBe(original);
  });

  it("treats Neon pooled and direct endpoint hostnames as the same target", () => {
    const direct = fingerprintDatabaseTarget(previewUrl);
    const pooled = fingerprintDatabaseTarget(
      "postgresql://preview_user:preview_password@ep-preview-id-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require",
    );

    expect(pooled).toBe(direct);
  });

  it("does not normalize a pooler-like hostname outside Neon", () => {
    const direct = fingerprintDatabaseTarget("postgresql://u:p@db.example.com/neondb");
    const poolerLike = fingerprintDatabaseTarget("postgresql://u:p@db-pooler.example.com/neondb");

    expect(poolerLike).not.toBe(direct);
  });

  it("does not return URL credentials or query values", () => {
    const fingerprint = fingerprintDatabaseTarget(previewUrl);
    expect(fingerprint).not.toContain("preview_user");
    expect(fingerprint).not.toContain("preview_password");
    expect(fingerprint).not.toContain("options");
    expect(fingerprint).not.toContain("secret");
    expect(fingerprint).not.toContain("neondb");
  });

  it("rejects missing, malformed, unsupported, or incomplete URLs", () => {
    expect(fingerprintDatabaseTarget(undefined)).toBeNull();
    expect(fingerprintDatabaseTarget(" ")).toBeNull();
    expect(fingerprintDatabaseTarget("not-a-url")).toBeNull();
    expect(fingerprintDatabaseTarget("https://db.example/neondb")).toBeNull();
    expect(fingerprintDatabaseTarget("postgresql://user:pass@db.example/")).toBeNull();
  });

  it("is available only when the runtime environment is Preview", () => {
    vi.stubEnv("DATABASE_URL", previewUrl);
    vi.stubEnv("VERCEL_ENV", "preview");
    const previewFingerprint = getPreviewDatabaseTargetFingerprint();
    expect(previewFingerprint).toBe(fingerprintDatabaseTarget(previewUrl));

    vi.stubEnv("VERCEL_ENV", "production");
    expect(getPreviewDatabaseTargetFingerprint()).toBeNull();
  });

  it("verifies a target fingerprint without echoing endpoint input", () => {
    const hostname = "ep-preview-id.us-west-2.aws.neon.tech";
    const fingerprint = fingerprintDatabaseTarget(`postgres://u:p@${hostname}/neondb`)!;
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/verify-preview-db-target.mjs");
    const result = spawnSync(process.execPath, [script, fingerprint, hostname, "neondb"], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("PASS: Preview database target matches the expected Neon endpoint/database.");
    expect(result.stdout).not.toContain(hostname);
    expect(result.stderr).toBe("");
  });

  it("verifies a pooled runtime target against the direct Neon endpoint hostname", () => {
    const hostname = "ep-preview-id.us-west-2.aws.neon.tech";
    const pooledFingerprint = fingerprintDatabaseTarget(
      `postgres://u:p@ep-preview-id-pooler.us-west-2.aws.neon.tech/neondb`,
    )!;
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/verify-preview-db-target.mjs");
    const result = spawnSync(process.execPath, [script, pooledFingerprint, hostname, "neondb"], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("PASS: Preview database target matches the expected Neon endpoint/database.");
    expect(result.stdout).not.toContain(hostname);
    expect(result.stderr).toBe("");
  });

  it("fails a mismatched fingerprint without echoing the supplied target", () => {
    const hostname = "ep-preview-id.us-west-2.aws.neon.tech";
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/verify-preview-db-target.mjs");
    const result = spawnSync(process.execPath, [script, "0".repeat(64), hostname, "neondb"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("FAIL: Preview database target does not match the expected Neon endpoint/database.");
    expect(result.stderr).not.toContain(hostname);
    expect(result.stdout).toBe("");
  });
});

