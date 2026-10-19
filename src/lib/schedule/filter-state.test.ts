import { describe, expect, it } from "vitest";
import {
  applyScheduleFilters,
  DEFAULT_SCHEDULE_FILTERS,
  parseScheduleFilters,
} from "./filter-state";

describe("shareable schedule filter state", () => {
  it("parses valid filters and ignores unrelated query parameters", () => {
    expect(parseScheduleFilters(new URLSearchParams(
      "range=seven&game=cs2&league=ESL%20One&status=running&q=Team%20A&date=2026-10-21&utm_source=share",
    ))).toEqual({
      range: "seven",
      game: "cs2",
      league: "ESL One",
      status: "running",
      query: "Team A",
      selectedDate: "2026-10-21",
    });
  });

  it("falls back to defaults for unknown enum values and impossible calendar dates", () => {
    expect(parseScheduleFilters(new URLSearchParams(
      "range=next&game=unknown&status=live&date=2026-02-30",
    ))).toEqual(DEFAULT_SCHEDULE_FILTERS);
  });

  it("bounds free-text values to the same stable URL representation", () => {
    const longValue = "队伍".repeat(100);
    const parsed = parseScheduleFilters(new URLSearchParams(`q=${encodeURIComponent(`  ${longValue}  `)}&league=${encodeURIComponent(longValue)}`));
    expect(parsed.query).toBe(longValue.slice(0, 120));
    expect(parsed.league).toBe(longValue.slice(0, 120));
  });

  it("round-trips all active filters while preserving non-filter parameters", () => {
    const filters = {
      range: "history" as const,
      game: "honor-of-kings" as const,
      league: "王者荣耀世界冠军杯",
      status: "finished" as const,
      query: "Nova vs Alpha",
      selectedDate: "2026-10-04",
    };
    const query = applyScheduleFilters(new URLSearchParams("utm_campaign=share&game=lol"), filters);

    expect(query.get("utm_campaign")).toBe("share");
    expect(parseScheduleFilters(query)).toEqual(filters);
  });

  it("omits default filters and clears all owned parameters on reset", () => {
    const query = applyScheduleFilters(
      new URLSearchParams("range=tomorrow&game=lol&league=ESL&status=running&q=old&date=2026-10-04&ref=home"),
      DEFAULT_SCHEDULE_FILTERS,
    );

    expect(query.toString()).toBe("ref=home");
    expect(parseScheduleFilters(query)).toEqual(DEFAULT_SCHEDULE_FILTERS);
  });
});
