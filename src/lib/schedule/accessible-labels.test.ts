import { describe, expect, it } from "vitest";
import { getStreamLinkAccessibleName } from "./accessible-labels";

describe("stream link accessible names", () => {
  it("identifies the event, stage, and teams in a screen-reader link list", () => {
    expect(getStreamLinkAccessibleName("立即观看", {
      league: "全球冠军赛",
      tournament: "淘汰赛",
      stage: "决赛",
      homeTeam: { name: "Alpha", logo: "" },
      awayTeam: { name: "Bravo", logo: "" },
    })).toBe("立即观看：全球冠军赛，淘汰赛，决赛，Alpha 对阵 Bravo");
  });

  it("keeps useful context when optional tournament fields are absent", () => {
    expect(getStreamLinkAccessibleName("直播入口", {
      league: "区域联赛",
      tournament: null,
      stage: null,
      homeTeam: { name: "待定", logo: "" },
      awayTeam: { name: "TBD", logo: "" },
    })).toBe("直播入口：区域联赛，待定 对阵 TBD");
  });
});
