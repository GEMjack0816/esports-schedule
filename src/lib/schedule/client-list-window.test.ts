import { describe, expect, it } from "vitest";
import {
  MATCH_RENDER_BATCH_SIZE,
  nextMatchLimit,
  resetMatchListWindow,
  visibleMatchLimit,
  windowMatches,
} from "./client-list-window";

describe("progressive match list window", () => {
  it("starts every new filter at a bounded render batch", () => {
    expect(visibleMatchLimit({ filterKey: "all", limit: 600 }, "history"))
      .toBe(MATCH_RENDER_BATCH_SIZE);
  });

  it("retains the expanded window while the filter is unchanged", () => {
    expect(visibleMatchLimit({ filterKey: "all", limit: 600 }, "all")).toBe(600);
  });

  it("does not restore an old expanded window after switching away and back", () => {
    const expanded = { filterKey: "all", limit: 400 };
    const afterChangingToLol = resetMatchListWindow();
    expect(visibleMatchLimit(afterChangingToLol, "lol")).toBe(MATCH_RENDER_BATCH_SIZE);

    const afterReturningToAll = resetMatchListWindow();
    expect(visibleMatchLimit(afterReturningToAll, "all")).toBe(MATCH_RENDER_BATCH_SIZE);
    expect(visibleMatchLimit(expanded, "all")).toBe(400);
  });

  it("advances one batch without exceeding the complete result count", () => {
    expect(nextMatchLimit(200, 3_332)).toBe(400);
    expect(nextMatchLimit(3_200, 3_332)).toBe(3_332);
    expect(nextMatchLimit(200, 25)).toBe(25);
  });

  it("shows the most recent history window while retaining ascending order within it", () => {
    expect(windowMatches([1, 2, 3, 4, 5], 2, true)).toEqual([4, 5]);
    expect(windowMatches([1, 2, 3, 4, 5], 2, false)).toEqual([1, 2]);
  });
});
