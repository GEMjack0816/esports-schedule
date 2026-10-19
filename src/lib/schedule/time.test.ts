import { describe, expect, it } from "vitest";
import { addDaysKey, dateKeyInTimeZone, dateRangeBoundsInTimeZone } from "./time";

describe("visitor-local calendar date handling", () => {
  it("adds calendar days across the spring DST transition", () => {
    const justBeforeMidnight = Date.parse("2026-03-08T07:30:00.000Z");

    expect(dateKeyInTimeZone(new Date(justBeforeMidnight), "America/Los_Angeles")).toBe("2026-03-07");
    expect(addDaysKey(1, "America/Los_Angeles", justBeforeMidnight)).toBe("2026-03-08");
    expect(addDaysKey(6, "America/Los_Angeles", justBeforeMidnight)).toBe("2026-03-13");
  });

  it("adds calendar days across the fall DST transition", () => {
    const beforeFallback = Date.parse("2026-11-01T07:30:00.000Z");

    expect(dateKeyInTimeZone(new Date(beforeFallback), "America/Los_Angeles")).toBe("2026-11-01");
    expect(addDaysKey(1, "America/Los_Angeles", beforeFallback)).toBe("2026-11-02");
  });

  it("sets date-picker bounds using the visitor's timezone rather than UTC dates", () => {
    const matchTime = "2026-10-19T20:00:00.000Z";

    expect(dateRangeBoundsInTimeZone(matchTime, matchTime, "Pacific/Kiritimati"))
      .toEqual({ min: "2026-10-20", max: "2026-10-20" });
    expect(dateRangeBoundsInTimeZone(matchTime, matchTime, "America/Los_Angeles"))
      .toEqual({ min: "2026-10-19", max: "2026-10-19" });
  });

  it("leaves date-picker bounds unset when the collected range is unknown", () => {
    expect(dateRangeBoundsInTimeZone(null, null, "UTC"))
      .toEqual({ min: undefined, max: undefined });
  });
});
