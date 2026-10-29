import { describe, expect, it } from "vitest";
import type { EsportsMatch } from "@/lib/schedule/types";
import { buildMatchShareText } from "./share";

const match: EsportsMatch = {
  id: "lol-123",
  provider: "pandascore",
  providerMatchId: "123",
  game: "lol",
  league: "LPL",
  tournament: "夏季赛",
  stage: "决赛",
  homeTeam: { name: "Team A", acronym: "A", logo: "" },
  awayTeam: { name: "Team B", acronym: "B", logo: "" },
  homeScore: 3,
  awayScore: 1,
  bestOf: 5,
  status: "finished",
  startTimeUtc: "2026-10-29T10:00:00.000Z",
  streams: [{ label: "Broadcast", url: "https://stream.example/watch?token=private" }],
  lastUpdatedAt: "2026-10-29T10:05:00.000Z",
};

describe("buildMatchShareText", () => {
  it("includes the event, teams, local time, format, score, status, and clean site URL", () => {
    const text = buildMatchShareText(match, {
      game: "英雄联盟",
      status: "已结束",
      localStartTime: "2026年10月29日 18:00",
      localTimeZone: "Asia/Shanghai",
      siteUrl: "https://example.test/",
    });

    expect(text).toContain("英雄联盟 · LPL · 夏季赛 · 决赛");
    expect(text).toContain("Team A vs Team B");
    expect(text).toContain("时间（Asia/Shanghai）：2026年10月29日 18:00");
    expect(text).toContain("赛制：BO5");
    expect(text).toContain("比分：3–1");
    expect(text).toContain("状态：已结束");
    expect(text).toContain("赛程：https://example.test/");
  });

  it("handles unknown time, missing score, and unknown best-of without provider links", () => {
    const text = buildMatchShareText({
      ...match,
      tournament: null,
      stage: null,
      homeScore: null,
      awayScore: null,
      bestOf: null,
    }, {
      game: "无畏契约",
      status: "未开始",
      localStartTime: "待定",
      localTimeZone: "Asia/Shanghai",
      siteUrl: "https://example.test/",
    });

    expect(text).toContain("无畏契约 · LPL");
    expect(text).toContain("时间（Asia/Shanghai）：待定");
    expect(text).toContain("赛制：待定");
    expect(text).not.toContain("比分：");
    expect(text).not.toContain("stream.example");
    expect(text).not.toContain("token=private");
  });

  it("keeps provider-controlled event and team names on one line and strips bidi controls", () => {
    const text = buildMatchShareText({
      ...match,
      league: "LPL\n伪造新行",
      homeTeam: { ...match.homeTeam, name: "Team A\n状态：已取消\u202e" },
    }, {
      game: "英雄联盟",
      status: "已结束",
      localStartTime: "2026年10月29日 18:00",
      localTimeZone: "Asia/Shanghai",
      siteUrl: "https://example.test/",
    });

    expect(text.split("\n")).toHaveLength(7);
    expect(text).toContain("LPL 伪造新行 · 夏季赛 · 决赛");
    expect(text).toContain("Team A 状态：已取消 vs Team B");
    expect(text).not.toContain("\u202e");
  });
});
