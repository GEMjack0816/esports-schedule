import { describe, expect, it } from "vitest";
import { dateKeyInTimeZone, getDateKeyFormatter } from "./time";

describe("timezone date-key formatter cache", () => {
  it("reuses formatters while preserving date boundaries across DST", () => {
    const first = getDateKeyFormatter("America/Los_Angeles");
    expect(getDateKeyFormatter("America/Los_Angeles")).toBe(first);

    expect(dateKeyInTimeZone("2026-03-08T07:30:00.000Z", "America/Los_Angeles")).toBe("2026-03-07");
    expect(dateKeyInTimeZone("2026-03-08T08:30:00.000Z", "America/Los_Angeles")).toBe("2026-03-08");
  });

  it("bounds timezone entries with LRU eviction", () => {
    const zones = [
      "Africa/Abidjan",
      "America/Anchorage",
      "America/Argentina/Buenos_Aires",
      "Asia/Kathmandu",
      "Australia/Adelaide",
      "Europe/Helsinki",
      "Indian/Maldives",
      "Pacific/Chatham",
      "Pacific/Apia",
    ];
    const first = getDateKeyFormatter(zones[0]);

    for (const zone of zones.slice(1)) getDateKeyFormatter(zone);

    expect(getDateKeyFormatter(zones[0])).not.toBe(first);
    const mostRecent = getDateKeyFormatter(zones[zones.length - 1]);
    expect(getDateKeyFormatter(zones[zones.length - 1])).toBe(mostRecent);
  });
});
