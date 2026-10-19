import { describe, expect, it } from "vitest";
import { timeZoneLocationLabel, timeZoneUtcOffset } from "./time";

describe("time zone indicator formatting", () => {
  it("uses a readable final location segment", () => {
    expect(timeZoneLocationLabel("Asia/Shanghai")).toBe("Shanghai");
    expect(timeZoneLocationLabel("America/Los_Angeles")).toBe("Los Angeles");
    expect(timeZoneLocationLabel("UTC")).toBe("UTC");
  });

  it("formats whole-hour and fractional UTC offsets", () => {
    const winter = new Date("2026-01-15T12:00:00.000Z");
    expect(timeZoneUtcOffset("Asia/Shanghai", winter)).toBe("UTC+08:00");
    expect(timeZoneUtcOffset("Asia/Kathmandu", winter)).toBe("UTC+05:45");
    expect(timeZoneUtcOffset("America/St_Johns", winter)).toBe("UTC-03:30");
    expect(timeZoneUtcOffset("UTC", winter)).toBe("UTC+00:00");
  });

  it("uses the offset at the supplied instant across daylight-saving changes", () => {
    expect(timeZoneUtcOffset("America/Los_Angeles", new Date("2026-01-15T12:00:00.000Z")))
      .toBe("UTC-08:00");
    expect(timeZoneUtcOffset("America/Los_Angeles", new Date("2026-07-15T12:00:00.000Z")))
      .toBe("UTC-07:00");
  });

  it("falls back safely for an invalid zone", () => {
    expect(timeZoneUtcOffset("Not/AZone", new Date("2026-01-15T12:00:00.000Z")))
      .toBe("UTC+00:00");
  });
});
