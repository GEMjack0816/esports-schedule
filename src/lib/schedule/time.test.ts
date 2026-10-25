import { describe, expect, it } from "vitest";
import { dateInputBoundsInTimeZone } from "./time";

describe("schedule date input bounds", () => {
  it("uses local calendar dates for UTC-12 so the earliest match day remains selectable", () => {
    expect(dateInputBoundsInTimeZone(
      "2026-10-02T06:00:00.000Z",
      "2026-10-03T05:00:00.000Z",
      "Etc/GMT+12",
    )).toEqual({ min: "2026-10-01", max: "2026-10-02" });
  });

  it("uses local calendar dates for UTC+14 so the latest match day remains selectable", () => {
    expect(dateInputBoundsInTimeZone(
      "2026-10-02T10:00:00.000Z",
      "2026-10-03T11:00:00.000Z",
      "Pacific/Kiritimati",
    )).toEqual({ min: "2026-10-03", max: "2026-10-04" });
  });

  it("omits unavailable or malformed bounds", () => {
    expect(dateInputBoundsInTimeZone(null, "not-a-timestamp", "Asia/Shanghai"))
      .toEqual({ min: undefined, max: undefined });
  });
});
