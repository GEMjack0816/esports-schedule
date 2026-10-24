import { afterEach, describe, expect, it, vi } from "vitest";
import { dynamic, GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/version", () => {
  it("is dynamic, disables caching, and returns only public metadata", async () => {
    vi.stubEnv("PANDASCORE_TOKEN", "sensitive-pandascore-sentinel");
    vi.stubEnv("CRON_SECRET", "sensitive-cron-sentinel");

    const response = GET();
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
    expect(body.service).toBe("esports-schedule");
    expect(body.runtimeTimestamp).toEqual(expect.any(String));
    expect(Object.keys(body).sort()).toEqual([
      "buildTimestamp",
      "deploymentId",
      "deploymentUrl",
      "environment",
      "gitCommitRef",
      "gitCommitSha",
      "runtimeTimestamp",
      "service",
    ]);
    expect(bodyText).not.toContain("PANDASCORE_TOKEN");
    expect(bodyText).not.toContain("CRON_SECRET");
    expect(bodyText).not.toContain("sensitive-pandascore-sentinel");
    expect(bodyText).not.toContain("sensitive-cron-sentinel");
    expect(bodyText).not.toContain("Authorization");
    expect(bodyText).not.toContain("Cookie");
  });
});
