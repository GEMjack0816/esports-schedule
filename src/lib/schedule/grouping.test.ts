import { describe, expect, it } from "vitest";
import { groupMatchesByDate } from "./grouping";
import type { EsportsMatch } from "./types";

function match(id: string, startTimeUtc: string | null): EsportsMatch {
  return {
    id,
    provider: "pandascore",
    providerMatchId: id,
    game: "lol",
    tournament: null,
    league: "Test League",
    stage: null,
    homeTeam: { name: "Alpha", acronym: "A", logo: "/team-placeholder.svg" },
    awayTeam: { name: "Beta", acronym: "B", logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: null,
    status: "scheduled",
    startTimeUtc,
    streams: [],
    lastUpdatedAt: "2026-10-18T00:00:00.000Z",
  };
}

describe("groupMatchesByDate", () => {
  it("groups by visitor-local date, preserves match order, and sorts unscheduled last", () => {
    const matches = [
      match("tomorrow", "2026-10-19T18:00:00.000Z"),
      match("today-first", "2026-10-18T12:00:00.000Z"),
      match("unscheduled", null),
      match("today-second", "2026-10-18T13:00:00.000Z"),
    ];

    expect(groupMatchesByDate(matches, "Asia/Shanghai")).toEqual([
      ["2026-10-18", [matches[1], matches[3]]],
      ["2026-10-20", [matches[0]]],
      ["unscheduled", [matches[2]]],
    ]);
    expect(groupMatchesByDate(matches, "Asia/Shanghai", "descending").map(([key]) => key))
      .toEqual(["2026-10-20", "2026-10-18", "unscheduled"]);
  });

  it("does not repeatedly iterate and copy a large same-day group", () => {
    // Exercise a same-day batch at the size of a large production snapshot.
    const matches = Array.from({ length: 3_300 }, (_, index) =>
      match(String(index), "2026-10-18T12:00:00.000Z"),
    );
    const originalIterator = Array.prototype[Symbol.iterator];
    let iteratedArrayElements = 0;

    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: function* <T>(this: T[]) {
        if (this.length >= 50) iteratedArrayElements += this.length;
        yield* originalIterator.call(this);
      },
    });

    let groups: ReturnType<typeof groupMatchesByDate>;
    try {
      groups = groupMatchesByDate(matches, "UTC");
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: originalIterator,
      });
    }

    expect(iteratedArrayElements).toBeLessThan(matches.length * 2);
    expect(groups).toHaveLength(1);
    expect(groups[0][1]).toHaveLength(matches.length);
    expect(groups[0][1][0].id).toBe("0");
    expect(groups[0][1].at(-1)?.id).toBe("3299");
  });
});
