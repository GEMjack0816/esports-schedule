import { describe, expect, it } from "vitest";
import { dateInputBoundsInTimeZone } from "./time";

describe("schedule date input bounds", () => {
  it("uses local calendar dates for UTC-12 so the earliest match day remains selectable", () => {
    expect(dateInputBoundsInTimeZone(
      "2026-10-02T06:00:00.000Z",
      "2026-10-03T05:00:00.000Z",
      "Etc/GMT+12",
      "2026-10-02",
    )).toEqual({ min: "2026-10-01", max: "2026-10-02" });
  });

  it("uses local calendar dates for UTC+14 so the latest match day remains selectable", () => {
    expect(dateInputBoundsInTimeZone(
      "2026-10-02T10:00:00.000Z",
      "2026-10-03T11:00:00.000Z",
      "Pacific/Kiritimati",
      "2026-10-02",
    )).toEqual({ min: "2026-10-02", max: "2026-10-04" });
  });

  it("always keeps local Today selectable when all fixtures are historical", () => {
    expect(dateInputBoundsInTimeZone(
      "2026-10-18T12:00:00.000Z",
      "2026-10-21T12:00:00.000Z",
      "Asia/Shanghai",
      "2026-10-22",
    )).toEqual({ min: "2026-10-18", max: "2026-10-22" });
  });

  it("always keeps local Today selectable when all fixtures are upcoming", () => {
    expect(dateInputBoundsInTimeZone(
      "2026-10-23T12:00:00.000Z",
      "2026-10-26T12:00:00.000Z",
      "Asia/Shanghai",
      "2026-10-22",
    )).toEqual({ min: "2026-10-22", max: "2026-10-26" });
  });

  it("restricts an unavailable or malformed range to local Today", () => {
    expect(dateInputBoundsInTimeZone(null, "not-a-timestamp", "Asia/Shanghai", "2026-10-22"))
      .toEqual({ min: "2026-10-22", max: "2026-10-22" });
  });
});
