import { beforeEach, describe, expect, it, vi } from "vitest";

const { after, getSchedule, refreshSchedule, shouldRefreshSchedule } = vi.hoisted(() => ({
  after: vi.fn(),
  getSchedule: vi.fn(),
  refreshSchedule: vi.fn(),
  shouldRefreshSchedule: vi.fn(),
}));

vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/schedule", () => ({ getSchedule, refreshSchedule, shouldRefreshSchedule }));

import { GET } from "./route";

const schedule = {
  matches: [],
  generatedAt: "2026-08-30T00:00:00.000Z",
  mode: "live",
  stale: true,
  coverage: { refreshInProgress: false },
};

describe("GET /api/matches", () => {
  beforeEach(() => {
    after.mockReset();
    getSchedule.mockReset().mockResolvedValue(schedule);
    refreshSchedule.mockReset();
    shouldRefreshSchedule.mockReset().mockReturnValue(true);
  });

  it("preserves stale-while-refresh behavior for the regular schedule endpoint", async () => {
    const response = await GET(new Request("https://example.test/api/matches"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-schedule-refresh-scheduled")).toBe("true");
    expect(after).toHaveBeenCalledTimes(1);
    expect(getSchedule).toHaveBeenCalledWith({ cachedOnly: true });
    expect(refreshSchedule).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(schedule);
  });

  it("returns a cache-only snapshot without scheduling another background sync", async () => {
    const response = await GET(new Request("https://example.test/api/matches?snapshotOnly=1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-schedule-refresh-scheduled")).toBe("false");
    expect(after).not.toHaveBeenCalled();
    expect(shouldRefreshSchedule).not.toHaveBeenCalled();
    expect(refreshSchedule).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(schedule);
  });
});
