import { describe, expect, it } from "vitest";
import type { EsportsMatch } from "./types";
import { buildScheduleCalendar, calendarExportFilename, isCalendarExportable } from "./calendar-export";

function match(overrides: Partial<EsportsMatch> = {}): EsportsMatch {
  return {
    id: "pandascore:lol:42",
    provider: "pandascore",
    providerMatchId: "42",
    game: "lol",
    tournament: "Worlds",
    league: "League of Legends World Championship",
    stage: "Group Stage",
    homeTeam: { name: "T1", acronym: "T1", logo: "/team-placeholder.svg" },
    awayTeam: { name: "Gen.G", acronym: "GEN", logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc: "2026-10-19T12:30:00.000Z",
    streams: [{ label: "Official", url: "https://stream.example/live" }],
    lastUpdatedAt: "2026-10-19T10:00:00.000Z",
    ...overrides,
  };
}

describe("schedule calendar export", () => {
  it("names an exact-date export by its selected date instead of the retained quick range", () => {
    expect(calendarExportFilename("today", "2026-10-20")).toBe("esports-schedule-date-2026-10-20.ics");
    expect(calendarExportFilename("tomorrow", "")).toBe("esports-schedule-tomorrow.ics");
    expect(calendarExportFilename("seven", "2026-02-30")).toBe("esports-schedule-seven.ics");
  });

  it("exports a timed fixture with stable UTC timestamps and a safe stream URL", () => {
    const content = buildScheduleCalendar(
      [match()],
      new Date("2026-10-19T11:00:00.000Z"),
    );

    expect(content).toContain("BEGIN:VCALENDAR\r\n");
    expect(content).toContain("BEGIN:VEVENT\r\n");
    expect(content).toContain("UID:pandascore%3Alol%3A42@esports-schedule\r\n");
    expect(content).toContain("DTSTAMP:20261019T110000Z\r\n");
    expect(content).toContain("DTSTART:20261019T123000Z\r\n");
    expect(content).toContain("DURATION:PT2H\r\n");
    expect(content.replace(/\r\n[ \t]/g, "")).toContain("日历预留估值：2 小时（非赛事官方结束时间）");
    expect(content).toContain("SUMMARY:T1 vs Gen.G · League of Legends World Championship\r\n");
    expect(content).toContain("STATUS:TENTATIVE\r\n");
    expect(content).toContain("URL:https://stream.example/live\r\n");
    expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(content.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes text control characters so user-controlled names cannot add properties", () => {
    const content = buildScheduleCalendar([match({
      homeTeam: { name: "Team A, Inc.;\\\r\nORGANIZER:mailto:attacker@example.com", logo: "" },
      league: "Finals,;\\\r\nATTENDEE:mailto:attacker@example.com",
    })]);

    expect(content).toContain("SUMMARY:Team A\\, Inc.\\;");
    expect(content).toContain("\\nORGANIZER:mailto:attacker@example.com");
    expect(content).toContain("\\nATTENDEE:mailto:attacker@example.com");
    expect(content).not.toMatch(/\r\n(?:ORGANIZER|ATTENDEE):/);
    expect(content).toContain("\r\nDESCRIPTION:");
  });

  it("folds long UTF-8 lines at RFC octet boundaries without splitting code points", () => {
    const content = buildScheduleCalendar([match({
      homeTeam: { name: "战队名🎮".repeat(30), logo: "" },
      league: "全球总决赛🏆".repeat(30),
    })]);
    const physicalLines = content.split("\r\n").filter(Boolean);

    expect(physicalLines.some((line) => line.startsWith(" "))).toBe(true);
    for (const line of physicalLines) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
      expect(line).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(line).not.toMatch(/^\s*[\uDC00-\uDFFF]/);
    }
  });

  it("omits unscheduled and invalid-time matches instead of inventing event times", () => {
    const unscheduled = match({ id: "manual:unscheduled", startTimeUtc: null });
    const invalid = match({ id: "manual:invalid", startTimeUtc: "not-a-timestamp" });
    const content = buildScheduleCalendar([unscheduled, invalid, match()]);

    expect(isCalendarExportable(unscheduled)).toBe(false);
    expect(isCalendarExportable(invalid)).toBe(false);
    expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(content).not.toContain("UID:manual%3Aunscheduled");
  });

  it("includes cancelled status and omits non-HTTPS stream links", () => {
    const content = buildScheduleCalendar([match({
      status: "cancelled",
      streams: [{ label: "unsafe", url: "javascript:alert(1)" }],
    })]);

    expect(content).toContain("STATUS:CANCELLED\r\n");
    expect(content).not.toContain("URL:");
    expect(content).not.toContain("javascript:");
  });

  it("omits credentialed stream URLs and selects the next safe HTTPS link", () => {
    const content = buildScheduleCalendar([match({
      streams: [
        { label: "userinfo", url: "https://viewer:password@stream.example/live" },
        { label: "snake-case credential", url: "https://stream.example/live?refresh_token=redacted" },
        { label: "camel-case credential", url: "https://stream.example/live?clientSecret=redacted" },
        { label: "safe", url: "https://stream.example/channel" },
      ],
    })]);

    expect(content).toContain("URL:https://stream.example/channel\r\n");
    expect(content).not.toContain("viewer:password");
    expect(content).not.toContain("refresh_token");
    expect(content).not.toContain("clientSecret");
    expect(content).not.toContain("redacted");
  });

  it("omits stream URLs with credentials in the fragment", () => {
    const content = buildScheduleCalendar([match({
      streams: [
        { label: "fragment credential", url: "https://stream.example/live#/watch?access_token=redacted" },
      ],
    })]);

    expect(content).not.toContain("URL:");
    expect(content).not.toContain("access_token");
    expect(content).not.toContain("redacted");
  });
});
