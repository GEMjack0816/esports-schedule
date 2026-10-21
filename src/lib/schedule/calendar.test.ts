import { describe, expect, it } from "vitest";
import { addDaysKey } from "./time";

describe("visitor calendar day shortcuts", () => {
  it.each([
    ["America/New_York", "2026-03-08T04:30:00Z", 1, "2026-03-08"],
    ["America/New_York", "2026-11-01T04:30:00Z", 1, "2026-11-02"],
    ["America/New_York", "2026-03-03T04:30:00Z", 6, "2026-03-08"],
    ["America/New_York", "2026-10-27T04:30:00Z", 6, "2026-11-02"],
    ["Europe/Berlin", "2026-03-28T22:30:00Z", 1, "2026-03-29"],
    ["Australia/Sydney", "2026-04-04T13:30:00Z", 1, "2026-04-06"],
    ["Asia/Shanghai", "2026-12-31T16:30:00Z", 0, "2027-01-01"],
    ["Asia/Shanghai", "2026-12-31T16:30:00Z", 1, "2027-01-02"],
    ["UTC", "2028-02-28T12:00:00Z", 1, "2028-02-29"],
    ["UTC", "2026-03-01T12:00:00Z", -1, "2026-02-28"],
  ])("%s at %s plus %i calendar days yields %s", (zone, now, days, expected) => {
    expect(addDaysKey(days, zone, Date.parse(now))).toBe(expected);
  });
});
