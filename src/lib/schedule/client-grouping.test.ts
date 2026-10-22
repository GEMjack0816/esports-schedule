import { describe, expect, it } from "vitest";
import type { EsportsMatch } from "./types";
import { groupScheduleMatches } from "./client-grouping";

function match(id: string, startTimeUtc: string | null, status: EsportsMatch["status"] = "scheduled"): EsportsMatch {
  return {
    id,
    provider: "pandascore",
    providerMatchId: id,
    game: "lol",
    tournament: "Spring Cup",
    league: "LCK",
    stage: null,
    homeTeam: { name: `Home ${id}`, logo: "/team-placeholder.svg" },
    awayTeam: { name: `Away ${id}`, logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status,
    startTimeUtc,
    streams: [],
    lastUpdatedAt: "2026-03-08T00:00:00.000Z",
  };
}

describe("client schedule grouping", () => {
  it("groups matches by visitor-local day without changing within-day order", () => {
    const matches = [
      match("first", "2026-03-08T14:30:00.000Z"),
      match("second", "2026-03-08T15:30:00.000Z"),
      match("next-day", "2026-03-08T16:30:00.000Z"),
    ];

    const groups = groupScheduleMatches(matches, "Asia/Shanghai", "today");

    expect(groups.map(([key, items]) => [key, items.map((item) => item.id)])).toEqual([
      ["2026-03-08", ["first", "second"]],
      ["2026-03-09", ["next-day"]],
    ]);
  });

  it("sorts history newest-first and keeps unscheduled matches last", () => {
    const groups = groupScheduleMatches([
      match("older", "2026-03-07T12:00:00.000Z"),
      match("newer", "2026-03-09T12:00:00.000Z"),
      match("unscheduled", null),
    ], "UTC", "history");

    expect(groups.map(([key]) => key)).toEqual(["2026-03-09", "2026-03-07", "unscheduled"]);
  });

  it("groups running matches first even when their scheduled date is old or missing", () => {
    const groups = groupScheduleMatches([
      match("scheduled-today", "2026-03-08T12:00:00.000Z"),
      match("live-undated", null, "running"),
      match("live-yesterday", "2026-03-07T12:00:00.000Z", "running"),
      match("unscheduled", null),
    ], "UTC", "today");

    expect(groups.map(([key, items]) => [key, items.map((item) => item.id)])).toEqual([
      ["live", ["live-undated", "live-yesterday"]],
      ["2026-03-08", ["scheduled-today"]],
      ["unscheduled", ["unscheduled"]],
    ]);
  });

  it("keeps a live group first while preserving newest-first history order", () => {
    const groups = groupScheduleMatches([
      match("older", "2026-03-07T12:00:00.000Z"),
      match("live", "2026-03-06T12:00:00.000Z", "running"),
      match("newer", "2026-03-09T12:00:00.000Z"),
    ], "UTC", "history");

    expect(groups.map(([key]) => key)).toEqual(["live", "2026-03-09", "2026-03-07"]);
  });
});
