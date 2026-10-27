import { Children, isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./page";
import { getSchedule, shouldRefreshSchedule } from "@/lib/schedule";
import type { EsportsMatch, SchedulePayload } from "@/lib/schedule";
import type { SchedulePageData } from "@/lib/schedule/page-types";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/schedule", () => ({
  getSchedule: vi.fn(),
  refreshSchedule: vi.fn(),
  shouldRefreshSchedule: vi.fn(),
}));
vi.mock("@/lib/version", () => ({ getPublicVersionSummary: vi.fn(() => ({})) }));

function makeMatch(id: number, startTimeUtc: string): EsportsMatch {
  const matchId = `payload-${id}`;
  return {
    id: matchId,
    provider: "pandascore",
    providerMatchId: matchId,
    game: "lol",
    tournament: "Spring Cup",
    league: "LCK",
    stage: "Week 1",
    homeTeam: { name: `Home ${matchId}`, logo: "/team-placeholder.svg" },
    awayTeam: { name: `Away ${matchId}`, logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc,
    streams: [],
    lastUpdatedAt: startTimeUtc,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("homepage server payload", () => {
  it("serializes only one bounded page from a production-scale schedule snapshot", async () => {
    const startTimeUtc = new Date().toISOString();
    const schedule = {
      matches: Array.from({ length: 1_000 }, (_, index) => makeMatch(index, startTimeUtc)),
    } as SchedulePayload;
    vi.mocked(getSchedule).mockResolvedValue(schedule);
    vi.mocked(shouldRefreshSchedule).mockReturnValue(false);

    const tree = await Home() as ReactElement<{ children: React.ReactNode }>;
    const children = Children.toArray(tree.props.children);
    const dashboard = children.find((child): child is ReactElement<{ initialData: SchedulePageData }> =>
      isValidElement<{ initialData: SchedulePageData }>(child) && "initialData" in child.props);

    expect(dashboard).toBeDefined();
    if (!dashboard) throw new Error("Homepage did not pass initial page data to the schedule dashboard");
    const initialData = dashboard.props.initialData;
    expect(schedule.matches).toHaveLength(1_000);
    expect(initialData.matches).toHaveLength(initialData.page.limit);
    expect(initialData.matches.length).toBeLessThan(schedule.matches.length);
    expect(Buffer.byteLength(JSON.stringify(initialData))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(schedule)) / 10,
    );
  });
});
