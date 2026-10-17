import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fingerprintDatabaseTarget, getPreviewDatabaseTargetFingerprint } from "./identity";

const previewUrl = "postgresql://preview_user:preview_password@ep-preview-id.us-west-2.aws.neon.tech/neondb?sslmode=require&options=secret";

afterEach(() => vi.unstubAllEnvs());

describe("Preview database identity fingerprint", () => {
  it("is stable across credentials and connection options", () => {
    expect(fingerprintDatabaseTarget(previewUrl)).toBe(
      fingerprintDatabaseTarget("postgres://other:credentials@ep-preview-id.us-west-2.aws.neon.tech/neondb?sslmode=verify-full"),
    );
    expect(fingerprintDatabaseTarget(previewUrl)).toBe(
      fingerprintDatabaseTarget("postgres://other:credentials@ep-preview-id.us-west-2.aws.neon.tech:5432/neondb"),
    );
  });

  it("changes when the endpoint hostname or database name changes", () => {
    const fingerprint = fingerprintDatabaseTarget(previewUrl);
    expect(fingerprintDatabaseTarget("postgres://u:p@ep-other-id.us-west-2.aws.neon.tech/neondb")).not.toBe(fingerprint);
    expect(fingerprintDatabaseTarget("postgres://u:p@ep-preview-id.us-west-2.aws.neon.tech/otherdb")).not.toBe(fingerprint);
    expect(fingerprintDatabaseTarget("postgres://u:p@ep-preview-id.us-west-2.aws.neon.tech:5433/neondb")).not.toBe(fingerprint);
  });

  it("rejects malformed, unsupported, and incomplete values without exposing them", () => {
    expect(fingerprintDatabaseTarget(undefined)).toBeNull();
    expect(fingerprintDatabaseTarget("not-a-url")).toBeNull();
    expect(fingerprintDatabaseTarget("https://db.example/neondb")).toBeNull();
    expect(fingerprintDatabaseTarget("postgres://u:p@db.example/")).toBeNull();
  });

  it("is emitted only in Preview", () => {
    vi.stubEnv("DATABASE_URL", previewUrl);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(getPreviewDatabaseTargetFingerprint()).toBe(fingerprintDatabaseTarget(previewUrl));
    vi.stubEnv("VERCEL_ENV", "production");
    expect(getPreviewDatabaseTargetFingerprint()).toBeNull();
  });

  it("computes the expected target hash locally without echoing the endpoint", () => {
    const hostname = "ep-preview-id.us-west-2.aws.neon.tech";
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/fingerprint-preview-db-target.mjs");
    const result = spawnSync(process.execPath, [script, hostname, "neondb"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(fingerprintDatabaseTarget(previewUrl));
    expect(result.stdout).not.toContain(hostname);
    expect(result.stderr).toBe("");

    const explicitDefaultPort = spawnSync(process.execPath, [script, hostname, "neondb", "5432"], { encoding: "utf8" });
    expect(explicitDefaultPort.status).toBe(0);
    expect(explicitDefaultPort.stdout.trim()).toBe(result.stdout.trim());

    const differentPort = spawnSync(process.execPath, [script, hostname, "neondb", "5433"], { encoding: "utf8" });
    expect(differentPort.status).toBe(0);
    expect(differentPort.stdout.trim()).not.toBe(result.stdout.trim());
  });

  it("rejects an invalid port without printing the supplied value", () => {
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/fingerprint-preview-db-target.mjs");
    const result = spawnSync(process.execPath, [script, "db.example", "neondb", "70000"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain("70000");
    expect(result.stdout).toBe("");
  });

  it("rejects a connection URL instead of accepting or echoing credentials", () => {
    const connectionUrl = "postgresql://user:password@ep-preview-id.us-west-2.aws.neon.tech/neondb";
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/fingerprint-preview-db-target.mjs");
    const result = spawnSync(process.execPath, [script, connectionUrl, "neondb"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain("user");
    expect(result.stderr).not.toContain("password");
    expect(result.stdout).toBe("");
  });
});
