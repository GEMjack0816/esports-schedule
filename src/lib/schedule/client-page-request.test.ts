import { describe, expect, it } from "vitest";
import { isCurrentSchedulePageRequest } from "./client-page-request";

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
