import { describe, expect, it } from "vitest";
import {
  isCurrentSchedulePageRequest,
  isSchedulePageForCurrentFilters,
  schedulePageRequestKey,
} from "./client-page-request";

describe("schedule page request identity", () => {
  it("accepts the latest request for the active filters", () => {
    expect(isCurrentSchedulePageRequest(4, 4, "game=lol", "game=lol")).toBe(true);
  });

  it("rejects an old filter response before the next request serial advances", () => {
    // React updates the filter key in a layout effect before the new passive
    // effect starts the next request and increments its serial.
    expect(isCurrentSchedulePageRequest(4, 4, "game=lol", "game=cs2")).toBe(false);
  });

  it("rejects an older request after a newer request has started", () => {
    expect(isCurrentSchedulePageRequest(4, 5, "game=lol", "game=lol")).toBe(false);
  });
});

describe("displayed schedule page identity", () => {
  const filters = {
    range: "all" as const,
    timeZone: "Asia/Shanghai",
    game: "all" as const,
    league: "all",
    status: "all" as const,
    query: "  T1  ",
    selectedDate: null,
  };

  it("normalizes the search term into a stable page identity", () => {
    expect(schedulePageRequestKey(filters)).toBe(schedulePageRequestKey({ ...filters, query: "T1" }));
  });

  it("does not treat a previous filter result as the active page", () => {
    const previous = schedulePageRequestKey(filters);
    const active = schedulePageRequestKey({ ...filters, game: "cs2" });

    expect(isSchedulePageForCurrentFilters(previous, active)).toBe(false);
    expect(isSchedulePageForCurrentFilters(active, active)).toBe(true);
  });
});
