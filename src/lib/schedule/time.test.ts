import { describe, expect, it, vi } from "vitest";
import { dateKeyInTimeZone, getDateKeyFormatter } from "./time";

describe("schedule date keys", () => {
  it("preserves visitor-local dates across UTC midnight and daylight-saving boundaries", () => {
    expect(dateKeyInTimeZone("2026-03-08T07:30:00.000Z", "America/Los_Angeles"))
      .toBe("2026-03-07");
    expect(dateKeyInTimeZone("2026-11-01T07:30:00.000Z", "America/Los_Angeles"))
      .toBe("2026-11-01");
    expect(dateKeyInTimeZone("2026-10-13T17:00:00.000Z", "Asia/Shanghai"))
      .toBe("2026-10-14");
  });

  it("reuses date-key formatter instances for the same timezone", () => {
    expect(getDateKeyFormatter("UTC")).toBe(getDateKeyFormatter("UTC"));
  });

  it("reuses a local-date result for the same instant and timezone", () => {
    const formatToParts = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const instant = "2099-07-08T12:34:56.000Z";

    try {
      const fromString = dateKeyInTimeZone(instant, "Pacific/Chatham");
      const fromDate = dateKeyInTimeZone(new Date(instant), "Pacific/Chatham");

      expect(fromDate).toBe(fromString);
      expect(formatToParts).toHaveBeenCalledTimes(1);
    } finally {
      formatToParts.mockRestore();
    }
  });

  it("bounds formatter memory and evicts the least recently used timezone", () => {
    const timeZones = [
      "Etc/UTC",
      "Africa/Cairo",
      "America/Anchorage",
      "America/Argentina/Buenos_Aires",
      "Asia/Kathmandu",
      "Australia/Adelaide",
      "Europe/Helsinki",
      "Indian/Maldives",
      "Pacific/Auckland",
    ];
    const first = getDateKeyFormatter(timeZones[0]);

    for (const timeZone of timeZones.slice(1)) getDateKeyFormatter(timeZone);

    expect(getDateKeyFormatter(timeZones[0])).not.toBe(first);
    const recentlyUsed = getDateKeyFormatter(timeZones.at(-1)!);
    expect(getDateKeyFormatter(timeZones.at(-1)!)).toBe(recentlyUsed);
  });

  it("bounds date-result memory and evicts the least recently used key", () => {
    const formatToParts = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    const first = new Date(Date.UTC(2070, 0, 1));

    try {
      const firstKey = dateKeyInTimeZone(first, "UTC");
      for (let day = 1; day <= 8_192; day += 1) {
        dateKeyInTimeZone(new Date(first.getTime() + day * 86_400_000), "UTC");
      }

      expect(dateKeyInTimeZone(first, "UTC")).toBe(firstKey);
      expect(formatToParts).toHaveBeenCalledTimes(8_194);
    } finally {
      formatToParts.mockRestore();
    }
  });
});
