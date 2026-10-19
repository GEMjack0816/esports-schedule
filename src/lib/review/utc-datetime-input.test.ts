import { describe, expect, it } from "vitest";
import { normalizeUtcDateTimeInput, utcDateTimeLocalValue } from "./utc-datetime-input";

describe("admin UTC datetime-local fields", () => {
  it("formats stored UTC instants as UTC wall-clock values", () => {
    expect(utcDateTimeLocalValue(new Date("2026-08-20T03:45:00.000Z")))
      .toBe("2026-08-20T03:45");
  });

  it("preserves sub-minute precision when formatting stored instants", () => {
    expect(utcDateTimeLocalValue(new Date("2026-08-20T03:45:06.125Z")))
      .toBe("2026-08-20T03:45:06.125");
  });

  it("interprets timezone-less datetime-local input as UTC, not server local time", () => {
    expect(normalizeUtcDateTimeInput("2026-08-20T03:45"))
      .toBe("2026-08-20T03:45:00.000Z");
  });

  it("preserves seconds and milliseconds in datetime-local input", () => {
    expect(normalizeUtcDateTimeInput("2026-08-20T03:45:06.125"))
      .toBe("2026-08-20T03:45:06.125Z");
  });

  it("normalizes explicit offsets to UTC", () => {
    expect(normalizeUtcDateTimeInput("2026-08-20T11:45:00+08:00"))
      .toBe("2026-08-20T03:45:00.000Z");
  });

  it("rejects impossible or ambiguous date-time strings", () => {
    expect(() => normalizeUtcDateTimeInput("2026-02-30T03:45")).toThrow("比赛时间格式无效");
    expect(() => normalizeUtcDateTimeInput("2026-02-30T03:45Z")).toThrow("比赛时间格式无效");
    expect(() => normalizeUtcDateTimeInput("2026-08-20T03:45 local")).toThrow("比赛时间格式无效");
  });
});
