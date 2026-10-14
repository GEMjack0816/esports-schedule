import { describe, expect, it } from "vitest";
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
});
