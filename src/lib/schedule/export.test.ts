import { describe, expect, it, vi } from "vitest";
import type { EsportsMatch } from "./types";
import { createScheduleCsv } from "./export";

function match(overrides: Partial<EsportsMatch> = {}): EsportsMatch {
  return {
    id: "pandascore:lol:123",
    provider: "pandascore",
    providerMatchId: "123",
    game: "lol",
    tournament: "春季赛",
    league: "LPL",
    stage: "季后赛",
    homeTeam: { name: "Team A", logo: "/team-placeholder.svg" },
    awayTeam: { name: "Team B", logo: "/team-placeholder.svg" },
    homeScore: 2,
    awayScore: 1,
    bestOf: 3,
    status: "finished",
    startTimeUtc: "2026-10-16T16:30:00.000Z",
    streams: [{ label: "Official", url: "https://example.com/watch" }],
    lastUpdatedAt: "2026-10-16T17:00:00.000Z",
    ...overrides,
  };
}

describe("createScheduleCsv", () => {
  it("exports visible match details using the visitor timezone", () => {
    const csv = createScheduleCsv([match()], "Asia/Shanghai");
    expect(csv.startsWith("\uFEFF\"比赛日期\"")).toBe(true);
    expect(csv).toContain('"2026-10-17","00:30","Asia/Shanghai","英雄联盟","LPL","春季赛","季后赛"');
    expect(csv).toContain('"Team A","Team B","2 - 1","BO3","已结束"');
    expect(csv).toContain('"https://example.com/watch","pandascore:lol:123"');
    expect(csv).toContain("\r\n");
  });

  it("escapes CSV delimiters, quotes, and line breaks in user-controlled text", () => {
    const csv = createScheduleCsv([match({
      league: 'Cup, "Final"',
      homeTeam: { name: "Alpha\r\nPlayer", logo: "/team-placeholder.svg" },
    })], "UTC");
    expect(csv).toContain('"Cup, ""Final"""');
    expect(csv).toContain('"Alpha\r\nPlayer"');
  });

  it("neutralizes spreadsheet formulas after leading whitespace", () => {
    const csv = createScheduleCsv([match({
      league: "\t=IMPORTXML(\"https://bad.example\",\"//x\")",
      awayTeam: { name: "+SUM(1,1)", logo: "/team-placeholder.svg" },
    })], "UTC");
    expect(csv).toContain('"\'\t=IMPORTXML(""https://bad.example"",""//x"")"');
    expect(csv).toContain('"\'+SUM(1,1)"');
  });

  it("neutralizes formulas after leading ASCII control characters", () => {
    const csv = createScheduleCsv([match({
      league: "\u0000=1+1",
      stage: "\u001B+SUM(1,1)",
      tournament: "\u007F@SUM(1,1)",
    })], "UTC");
    expect(csv).toContain('"\'\u0000=1+1"');
    expect(csv).toContain('"\'\u001B+SUM(1,1)"');
    expect(csv).toContain('"\'\u007F@SUM(1,1)"');
  });

  it("handles unscheduled matches and partial scores without throwing", () => {
    const csv = createScheduleCsv([match({
      game: "honor-of-kings",
      startTimeUtc: null,
      homeScore: null,
      awayScore: 1,
      bestOf: null,
      status: "postponed",
      streams: [],
    })], "Asia/Shanghai");
    expect(csv).toContain('"","","","王者荣耀"');
    expect(csv).toContain('"– - 1","待定","已延期",""');
  });

  it("returns a valid header-only document for an empty filtered result", () => {
    const csv = createScheduleCsv([], "UTC");
    expect(csv.split("\r\n")).toHaveLength(1);
    expect(csv).toContain('"比赛 ID"');
  });

  it("creates one timezone formatter for a multi-match export", () => {
    const originalFormatToParts = Intl.DateTimeFormat.prototype.formatToParts;
    const formatters = new Set<Intl.DateTimeFormat>();
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(function (
      this: Intl.DateTimeFormat,
      date?: Date | number,
    ) {
      formatters.add(this);
      return originalFormatToParts.call(this, date);
    });
    createScheduleCsv([match(), match({ id: "pandascore:lol:456" }), match({ id: "pandascore:lol:789" })], "UTC");
    expect(formatters.size).toBe(1);
  });
});
