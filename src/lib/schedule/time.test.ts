import { describe, expect, it } from "vitest";
import { addDaysKey, dateInputBound, dateKeyInTimeZone } from "./time";

describe("visitor-local calendar dates", () => {
  it("uses local calendar days across the spring DST transition", () => {
    const beforeMidnight = Date.parse("2026-03-08T07:30:00.000Z");
    expect(dateKeyInTimeZone(new Date(beforeMidnight), "America/Los_Angeles")).toBe("2026-03-07");
    expect(addDaysKey(1, "America/Los_Angeles", beforeMidnight)).toBe("2026-03-08");
    expect(addDaysKey(6, "America/Los_Angeles", beforeMidnight)).toBe("2026-03-13");
  });

  it("uses local calendar days across the fall DST transition", () => {
    const beforeFallback = Date.parse("2026-11-01T07:30:00.000Z");
    expect(dateKeyInTimeZone(new Date(beforeFallback), "America/Los_Angeles")).toBe("2026-11-01");
    expect(addDaysKey(1, "America/Los_Angeles", beforeFallback)).toBe("2026-11-02");
  });

  it("converts date-picker bounds to the visitor timezone", () => {
    const timestamp = "2026-09-01T01:30:00.000Z";
    expect(dateInputBound(timestamp, "Asia/Shanghai")).toBe("2026-09-01");
    expect(dateInputBound(timestamp, "America/Los_Angeles")).toBe("2026-08-31");
    expect(dateInputBound("2026-09-02T23:30:00.000Z", "Asia/Shanghai")).toBe("2026-09-03");
  });

  it.each([null, undefined, "", "invalid"])("leaves a missing/invalid date bound unconstrained (%s)", (value) => {
    expect(dateInputBound(value, "UTC")).toBeUndefined();
  });
});
