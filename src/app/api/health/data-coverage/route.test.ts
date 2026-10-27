import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSchedule, getDatabaseHealth, getPublicVersionSummary } = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  getDatabaseHealth: vi.fn(),
  getPublicVersionSummary: vi.fn(),
}));

vi.mock("@/lib/schedule", () => ({ getSchedule }));
vi.mock("@/lib/review/public-matches", () => ({ getDatabaseHealth }));
vi.mock("@/lib/version", () => ({ getPublicVersionSummary }));

import { dynamic, GET } from "./route";

describe("GET /api/health/data-coverage", () => {
  beforeEach(() => {
    const staleGame = {
      sourceFetchedAt: "2026-10-27T02:00:00.000Z",
      lastSuccessfulSyncAt: "2026-10-27T02:00:00.000Z",
      snapshotAgeSeconds: 1_200,
      syncStatus: "delayed",
      dataSource: "persistent",
    };
    getSchedule.mockReset().mockResolvedValue({
      demoMode: false,
      providers: { pandascore: "stale-cache", manual: "json+database" },
      deployment: { gitCommitSha: "test-commit" },
      coverage: {
        mode: "live",
        stale: true,
        lastAttemptAt: "2026-10-27T02:00:00.000Z",
        lastSuccessfulSyncAt: "2026-10-27T02:00:00.000Z",
        sourceFetchedAt: "2026-10-27T02:00:00.000Z",
        snapshotAgeSeconds: 1_200,
        refreshInProgress: false,
        lastError: "UPSTREAM_TIMEOUT",
        games: {
          lol: staleGame,
          valorant: staleGame,
          "honor-of-kings": staleGame,
          cs2: staleGame,
          dota2: staleGame,
        },
      },
    });
    getDatabaseHealth.mockReset().mockResolvedValue({ status: "connected" });
    getPublicVersionSummary.mockReset().mockReturnValue({ gitCommitSha: "test-commit" });
  });

  it("keeps freshness health dynamic and uncacheable for browsers and Vercel CDN", async () => {
    const response = await GET();
    const body = await response.json();

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate",
    );
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(body).toMatchObject({
      mode: "live",
      stale: true,
      refreshInProgress: false,
      sourceFetchedAt: "2026-10-27T02:00:00.000Z",
      snapshotAgeSeconds: 1_200,
      providers: { pandascore: "stale-cache" },
      database: { status: "connected" },
    });
    for (const game of ["lol", "valorant", "honor-of-kings", "cs2", "dota2"]) {
      expect(body.games[game]).toMatchObject({
        sourceFetchedAt: "2026-10-27T02:00:00.000Z",
        lastSuccessfulSyncAt: "2026-10-27T02:00:00.000Z",
        snapshotAgeSeconds: 1_200,
        syncStatus: "delayed",
        dataSource: "persistent",
      });
    }
    expect(getSchedule).toHaveBeenCalledExactlyOnceWith({ cachedOnly: true });
    expect(getDatabaseHealth).toHaveBeenCalledExactlyOnceWith();
  });
});

