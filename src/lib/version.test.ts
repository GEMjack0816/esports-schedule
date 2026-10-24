import { describe, expect, it } from "vitest";
import { getPublicVersionInfo } from "./version";

describe("public deployment version metadata", () => {
  it("prefers official Vercel system values over build fallbacks", () => {
    const version = getPublicVersionInfo(new Date("2026-07-23T01:02:03.000Z"), {
      vercelTargetEnvironment: "production",
      vercelGitCommitSha: "official-sha",
      vercelGitCommitRef: "main",
      vercelDeploymentId: "dpl_official",
      vercelUrl: "example.vercel.app",
      buildEnvironment: "preview",
      buildGitCommitSha: "fallback-sha",
      buildGitCommitRef: "feature",
      buildDeploymentId: "dpl_fallback",
      buildDeploymentUrl: "fallback.vercel.app",
      buildTimestamp: "2026-07-23T00:00:00.000Z",
    });

    expect(version).toEqual({
      service: "esports-schedule",
      environment: "production",
      gitCommitSha: "official-sha",
      gitCommitRef: "main",
      deploymentId: "dpl_official",
      deploymentUrl: "https://example.vercel.app",
      buildTimestamp: "2026-07-23T00:00:00.000Z",
      runtimeTimestamp: "2026-07-23T01:02:03.000Z",
    });
  });

  it("uses build-time metadata when runtime system values are unavailable", () => {
    const version = getPublicVersionInfo(new Date("2026-07-23T01:02:03.000Z"), {
      buildEnvironment: "preview",
      buildGitCommitSha: "fallback-sha",
      buildGitCommitRef: "agent/version",
      buildDeploymentId: "dpl_fallback",
      buildDeploymentUrl: "https://fallback.vercel.app",
      buildTimestamp: "2026-07-23T00:00:00.000Z",
    });

    expect(version.environment).toBe("preview");
    expect(version.gitCommitSha).toBe("fallback-sha");
    expect(version.gitCommitRef).toBe("agent/version");
    expect(version.deploymentId).toBe("dpl_fallback");
    expect(version.deploymentUrl).toBe("https://fallback.vercel.app");
  });

  it("returns null for unavailable deployment values and never enumerates secrets", () => {
    const version = getPublicVersionInfo(new Date("2026-07-23T01:02:03.000Z"), {});
    const serialized = JSON.stringify(version);

    expect(version.gitCommitSha).toBeNull();
    expect(version.deploymentId).toBeNull();
    expect(version.buildTimestamp).toBeNull();
    expect(serialized).not.toContain("PANDASCORE_TOKEN");
    expect(serialized).not.toContain("CRON_SECRET");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Cookie");
  });

  it("keeps the build timestamp stable while runtime timestamps change", () => {
    const environment = { buildTimestamp: "2026-07-23T00:00:00.000Z" };
    const first = getPublicVersionInfo(new Date("2026-07-23T01:00:00.000Z"), environment);
    const second = getPublicVersionInfo(new Date("2026-07-23T02:00:00.000Z"), environment);

    expect(first.buildTimestamp).toBe(second.buildTimestamp);
    expect(first.runtimeTimestamp).not.toBe(second.runtimeTimestamp);
  });
});
