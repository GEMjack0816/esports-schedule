import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SchedulePayload } from "@/lib/schedule/types";

const mocks = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  refreshSchedule: vi.fn(),
  shouldRefreshSchedule: vi.fn(),
  after: vi.fn(),
}));

vi.mock("@/lib/schedule", () => ({
  getSchedule: mocks.getSchedule,
  refreshSchedule: mocks.refreshSchedule,
  shouldRefreshSchedule: mocks.shouldRefreshSchedule,
}));
vi.mock("next/server", () => ({ after: mocks.after }));

import { GET } from "./route";

const schedule = { matches: [] } as unknown as SchedulePayload;

describe("GET /api/matches/page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchedule.mockResolvedValue(schedule);
    mocks.shouldRefreshSchedule.mockReturnValue(false);
  });

  it("returns one filtered page with private no-store cache headers", async () => {
    const response = await GET(new Request("https://example.test/api/matches/page?range=all&timeZone=UTC&limit=2"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(body.matches).toEqual([]);
    expect(body.page).toMatchObject({ limit: 2, total: 0, nextCursor: null });
    expect(mocks.getSchedule).toHaveBeenCalledWith({ cachedOnly: true });
  });

  it("rejects malformed filters before reading the schedule", async () => {
    const response = await GET(new Request("https://example.test/api/matches/page?range=next-month"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_RANGE" });
    expect(mocks.getSchedule).not.toHaveBeenCalled();
  });

  it("keeps stale-while-refresh scheduling non-blocking", async () => {
    mocks.shouldRefreshSchedule.mockReturnValue(true);
    await GET(new Request("https://example.test/api/matches/page?range=today&timeZone=UTC"));

    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.refreshSchedule).not.toHaveBeenCalled();
  });
});
