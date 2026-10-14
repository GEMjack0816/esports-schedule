import { describe, expect, it } from "vitest";
import { getScheduleFormatters } from "./formatters";

describe("schedule date formatter cache", () => {
  it("reuses the formatter instances for repeated renders in one timezone", () => {
    const first = getScheduleFormatters("UTC");
    const second = getScheduleFormatters("UTC");

    expect(second).toBe(first);
    expect(second.time).toBe(first.time);
    expect(second.date).toBe(first.date);
    expect(second.dateTime).toBe(first.dateTime);
  });

  it("preserves visitor-local formatting for every formatter", () => {
    const value = new Date("2026-10-13T00:30:00.000Z");
    const timeZone = "America/Los_Angeles";
    const formatters = getScheduleFormatters(timeZone);

    expect(formatters.time.format(value)).toBe(new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(value));
    expect(formatters.date.format(value)).toBe(new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(value));
    expect(formatters.dateTime.format(value)).toBe(new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(value));
  });

  it("keeps formatter cache bounded while retaining recently used zones", () => {
    const initial = getScheduleFormatters("UTC");
    const zones = [
      "Africa/Abidjan",
      "America/Anchorage",
      "America/Argentina/Buenos_Aires",
      "Asia/Kathmandu",
      "Australia/Adelaide",
      "Europe/Helsinki",
      "Indian/Maldives",
      "Pacific/Chatham",
    ];

    for (const zone of zones) getScheduleFormatters(zone);

    expect(getScheduleFormatters("UTC")).not.toBe(initial);
    const mostRecentZone = zones[zones.length - 1];
    const recent = getScheduleFormatters(mostRecentZone);
    expect(getScheduleFormatters(mostRecentZone)).toBe(recent);
  });
});
