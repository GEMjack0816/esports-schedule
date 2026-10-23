import { describe, expect, it } from "vitest";
import type { EsportsMatch } from "./types";
import { getScheduleHeroStats, UPCOMING_HERO_WINDOW_MS } from "./hero-stats";

const nowMs = Date.parse("2026-10-22T00:00:00.000Z");

function match(status: EsportsMatch["status"], startTimeUtc: string | null): EsportsMatch {
  return {
    id: `${status}-${startTimeUtc ?? "unscheduled"}`,
    provider: "manual",
    providerMatchId: "test-match",
    game: "lol",
    tournament: null,
    league: "Test League",
    stage: null,
    homeTeam: { name: "Team A", logo: "/team-placeholder.svg" },
    awayTeam: { name: "Team B", logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: null,
    status,
    startTimeUtc,
    streams: [],
    lastUpdatedAt: new Date(nowMs).toISOString(),
  };
}

describe("schedule hero statistics", () => {
  it("counts scheduled matches only when they start in the next 24 hours", () => {
    const result = getScheduleHeroStats([
      match("scheduled", "2026-10-22T00:00:01.000Z"),
      match("scheduled", new Date(nowMs + UPCOMING_HERO_WINDOW_MS).toISOString()),
      match("scheduled", "2026-10-21T23:59:59.000Z"),
      match("scheduled", "2026-10-23T00:00:01.000Z"),
      match("scheduled", null),
      match("scheduled", "not-a-timestamp"),
      match("postponed", "2026-10-22T01:00:00.000Z"),
    ], nowMs);

    expect(result).toEqual({ liveCount: 0, upcomingCount: 2 });
  });

  it("counts explicitly running matches regardless of an absent start time", () => {
    expect(getScheduleHeroStats([
      match("running", null),
      match("running", "not-a-timestamp"),
      match("finished", "2026-10-22T01:00:00.000Z"),
    ], nowMs)).toEqual({ liveCount: 2, upcomingCount: 0 });
  });
});
