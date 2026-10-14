import { describe, expect, it } from "vitest";
import type { EsportsMatch } from "./types";
import { groupMatchesByDate, matchDateKey } from "./group-matches";

function match(id: string, startTimeUtc: string | null): EsportsMatch {
  return {
    id,
    provider: "manual",
    providerMatchId: id,
    game: "lol",
    tournament: null,
    league: "Test league",
    stage: null,
    homeTeam: { name: "Alpha", logo: "/team-placeholder.svg" },
    awayTeam: { name: "Beta", logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: null,
    status: "scheduled",
    startTimeUtc,
    streams: [],
    lastUpdatedAt: "2026-10-14T00:00:00.000Z",
  };
}

describe("schedule date grouping", () => {
  it("groups by visitor-local date, including matches crossing UTC midnight", () => {
    const earlyUtc = match("early-utc", "2026-10-14T01:00:00.000Z");
    const lateUtc = match("late-utc", "2026-10-13T17:00:00.000Z");

    expect(matchDateKey(earlyUtc, "America/Los_Angeles")).toBe("2026-10-13");
    expect(matchDateKey(lateUtc, "Asia/Shanghai")).toBe("2026-10-14");
  });

  it("sorts date groups while preserving match order within each day and unscheduled last", () => {
    const input = [
      match("day-14-first", "2026-10-14T02:00:00.000Z"),
      match("day-13", "2026-10-13T12:00:00.000Z"),
      match("day-14-second", "2026-10-14T08:00:00.000Z"),
      match("unscheduled", null),
    ];

    const ascending = groupMatchesByDate(input, "UTC");
    expect(ascending.map(([date]) => date)).toEqual(["2026-10-13", "2026-10-14", "unscheduled"]);
    expect(ascending[1][1].map(({ id }) => id)).toEqual(["day-14-first", "day-14-second"]);

    const descending = groupMatchesByDate(input, "UTC", true);
    expect(descending.map(([date]) => date)).toEqual(["2026-10-14", "2026-10-13", "unscheduled"]);
    expect(descending[0][1].map(({ id }) => id)).toEqual(["day-14-first", "day-14-second"]);
  });

  it("retains every entry in a large same-day group", () => {
    const matches = Array.from({ length: 3_332 }, (_, index) =>
      match(`match-${index}`, `2026-10-14T${String(index % 24).padStart(2, "0")}:00:00.000Z`));

    const grouped = groupMatchesByDate(matches, "UTC");

    expect(grouped).toHaveLength(1);
    expect(grouped[0][1]).toHaveLength(matches.length);
    expect(grouped[0][1][0]).toBe(matches[0]);
    expect(grouped[0][1].at(-1)).toBe(matches.at(-1));
  });
});
