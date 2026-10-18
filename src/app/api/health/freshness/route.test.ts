import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSchedule } = vi.hoisted(() => ({ getSchedule: vi.fn() }));

vi.mock("@/lib/schedule", () => ({
  FRESH_FOR_MS: 15 * 60 * 1_000,
  getSchedule,
}));

import { dynamic, GET } from "./route";

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    mode: "live",
    demoMode: false,
    stale: false,
    coverage: {
      snapshotAgeSeconds: 300,
      sourceFetchedAt: "2026-10-19T12:10:00.000Z",
      lastSuccessfulSyncAt: "2026-10-19T12:10:00.000Z",
      refreshInProgress: false,
    },
    providers: { pandascore: "connected" },
    ...overrides,
  };
}

describe("GET /api/health/freshness", () => {
  beforeEach(() => getSchedule.mockReset());

  it("returns 200 only for a fresh live, non-demo snapshot", async () => {
    getSchedule.mockResolvedValue(schedule());

    const response = await GET();
    expect(dynamic).toBe("force-dynamic");
    expect(getSchedule).toHaveBeenCalledWith({ cachedOnly: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      service: "esports-schedule",
      status: "fresh",
      mode: "live",
      stale: false,
      snapshotAgeSeconds: 300,
    });
  });

  it.each([
    ["stale snapshot", schedule({ stale: true })],
    ["expired age", schedule({ coverage: { ...schedule().coverage, snapshotAgeSeconds: 901 } })],
    ["missing age", schedule({ coverage: { ...schedule().coverage, snapshotAgeSeconds: null } })],
    ["missing timestamp", schedule({ coverage: { ...schedule().coverage, sourceFetchedAt: null } })],
    ["demo payload", schedule({ demoMode: true })],
  ])("returns 503 for %s", async (_label, value) => {
    getSchedule.mockResolvedValue(value);

    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "stale" });
  });

  it("reports unavailable snapshots as 503", async () => {
    getSchedule.mockResolvedValue(schedule({ mode: "unavailable", stale: true }));

    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unavailable",
      mode: "unavailable",
      stale: true,
    });
  });

  it("returns a sanitized 503 when schedule lookup throws", async () => {
    const internalError = "internal schedule lookup failure";
    getSchedule.mockImplementationOnce(async () => {
      throw new Error(internalError);
    });

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate");
    expect(JSON.parse(body)).toMatchObject({
      service: "esports-schedule",
      status: "unavailable",
      mode: "unavailable",
      stale: true,
    });
    expect(body).not.toContain(internalError);
  });

  it("does not expose unallowlisted schedule fields", async () => {
    getSchedule.mockResolvedValue(schedule({
      databaseUrl: "private-database-url",
      clientSecret: "private-client-secret",
    }));

    const response = await GET();
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).not.toContain("private-database-url");
    expect(body).not.toContain("private-client-secret");
  });
});
