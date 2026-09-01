import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshScheduleDetailed } = vi.hoisted(() => ({
  refreshScheduleDetailed: vi.fn(),
}));

vi.mock("@/lib/schedule", () => ({ refreshScheduleDetailed }));

import { GET } from "./route";

function schedule() {
  return {
    generatedAt: "2026-08-30T00:00:01.000Z",
    matches: [{ id: "one" }],
    mode: "live",
    stale: false,
    lastSuccessfulSyncAt: "2026-08-30T00:00:00.000Z",
    coverage: {
      sourceFetchedAt: "2026-08-30T00:00:00.000Z",
      snapshotAgeSeconds: 1,
      lastAttemptAt: "2026-08-30T00:00:00.000Z",
      refreshInProgress: false,
      lastError: null,
    },
    providers: { pandascore: "connected", manual: "json+database" },
  };
}

describe("protected schedule sync route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    refreshScheduleDetailed.mockReset();
  });

  it("rejects an anonymous request without starting synchronization", async () => {
    const response = await GET(new Request("https://example.com/api/cron/sync"));
    expect(response.status).toBe(401);
    expect(refreshScheduleDetailed).not.toHaveBeenCalled();
  });

  it("returns structured success without exposing authorization material", async () => {
    refreshScheduleDetailed.mockResolvedValue({
      schedule: schedule(),
      sync: {
        status: "success",
        lockAcquired: true,
        generation: 41,
        gamesAttempted: 5,
        gamesSucceeded: 5,
        gamesFailed: 0,
        snapshotsPersisted: 5,
        sourceFetchedAt: "2026-08-30T00:00:00.000Z",
        lastSuccessfulSyncAt: "2026-08-30T00:00:00.000Z",
        errors: [],
      },
    });
    const response = await GET(new Request("https://example.com/api/cron/sync", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({
      status: "success",
      lockAcquired: true,
      generation: 41,
      gamesSucceeded: 5,
      snapshotsPersisted: 5,
    });
    expect(text).not.toContain("test-cron-secret");
  });

  it("returns the actual fencing generation for a partial sync", async () => {
    refreshScheduleDetailed.mockResolvedValue({
      schedule: schedule(),
      sync: {
        status: "partial",
        lockAcquired: true,
        generation: 42,
        gamesAttempted: 5,
        gamesSucceeded: 4,
        gamesFailed: 1,
        snapshotsPersisted: 4,
        sourceFetchedAt: "2026-08-30T00:00:00.000Z",
        lastSuccessfulSyncAt: "2026-08-30T00:00:00.000Z",
        errors: [{ game: "cs2", code: "UPSTREAM", httpStatus: 500 }],
      },
    });
    const response = await GET(new Request("https://example.com/api/cron/sync", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "partial",
      generation: 42,
      gamesSucceeded: 4,
      gamesFailed: 1,
    });
  });

  it("returns a non-success HTTP status for a logical total failure", async () => {
    refreshScheduleDetailed.mockResolvedValue({
      schedule: { ...schedule(), mode: "unavailable", stale: true },
      sync: {
        status: "failed",
        lockAcquired: true,
        generation: 43,
        gamesAttempted: 5,
        gamesSucceeded: 0,
        gamesFailed: 5,
        snapshotsPersisted: 0,
        sourceFetchedAt: null,
        lastSuccessfulSyncAt: null,
        errors: [{ game: "lol", code: "UPSTREAM", httpStatus: 500 }],
      },
    });
    const response = await GET(new Request("https://example.com/api/cron/sync", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, status: "failed", generation: 43 });
  });

  it("reports lock contention as busy rather than a successful refresh", async () => {
    refreshScheduleDetailed.mockResolvedValue({
      schedule: schedule(),
      sync: {
        status: "busy",
        lockAcquired: false,
        generation: null,
        gamesAttempted: 0,
        gamesSucceeded: 0,
        gamesFailed: 0,
        snapshotsPersisted: 0,
        sourceFetchedAt: "2026-08-30T00:00:00.000Z",
        lastSuccessfulSyncAt: "2026-08-30T00:00:00.000Z",
        errors: [],
      },
    });
    const response = await GET(new Request("https://example.com/api/cron/sync", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "busy",
      lockAcquired: false,
      generation: null,
    });
  });
});
