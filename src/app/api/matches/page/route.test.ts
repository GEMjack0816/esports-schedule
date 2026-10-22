import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EsportsMatch, SchedulePayload } from "@/lib/schedule/types";
import { createSchedulePage, parseSchedulePageQuery } from "@/lib/schedule/server-page";

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

function match(id: string, startTimeUtc: string): EsportsMatch {
  return {
    id,
    provider: "pandascore",
    providerMatchId: id,
    game: "lol",
    tournament: "Spring Cup",
    league: "LCK",
    stage: null,
    homeTeam: { name: "Home", logo: "/team-placeholder.svg" },
    awayTeam: { name: "Away", logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc,
    streams: [],
    lastUpdatedAt: "2026-03-08T00:00:00.000Z",
  };
}

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

  it("returns 409 when a continuation cursor belongs to an older match set", async () => {
    const now = new Date("2026-03-08T00:00:00.000Z");
    const oldSchedule = {
      matches: [match("m1", "2026-03-08T10:00:00.000Z"), match("m2", "2026-03-08T11:00:00.000Z")],
    } as SchedulePayload;
    const firstPage = createSchedulePage(oldSchedule, parseSchedulePageQuery(new URLSearchParams({
      range: "all", timeZone: "UTC", limit: "1",
    })), now);
    mocks.getSchedule.mockResolvedValue({
      matches: [match("new-match", "2026-03-08T09:00:00.000Z"), ...oldSchedule.matches],
    } as SchedulePayload);

    const response = await GET(new Request(
      `https://example.test/api/matches/page?range=all&timeZone=UTC&limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor ?? "")}`,
    ));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "SCHEDULE_CHANGED" });
  });

  it("returns 400 for a malformed continuation cursor instead of an HTTP 500", async () => {
    const response = await GET(new Request(
      "https://example.test/api/matches/page?range=all&timeZone=UTC&cursor=not-a-cursor",
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_CURSOR" });
  });
});
