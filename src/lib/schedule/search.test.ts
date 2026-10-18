import { describe, expect, it } from "vitest";
import { normalizeScheduleSearchText, scheduleSearchMatches } from "./search";

describe("schedule search normalization", () => {
  it("uses locale-independent casing for Turkish I variants", () => {
    expect(normalizeScheduleSearchText("ISTANBUL")).toBe("istanbul");
    expect(scheduleSearchMatches("istanbul", ["İstanbul Wildcats"])).toBe(true);
    expect(scheduleSearchMatches("ISTANBUL", ["ıstanbul Wildcats"])).toBe(true);
  });

  it("matches accented and compatibility-equivalent Latin text", () => {
    expect(scheduleSearchMatches("sao paulo", ["São Paulo Esports"])).toBe(true);
    expect(scheduleSearchMatches("strasse", ["Straße Esports"])).toBe(true);
  });

  it("preserves non-Latin text and collapses incidental whitespace", () => {
    expect(normalizeScheduleSearchText("  王者荣耀　赛事  ")).toBe("王者荣耀 赛事");
    expect(scheduleSearchMatches("王者荣耀  赛事", ["王者荣耀", "赛事"])).toBe(true);
  });

  it("treats an empty query as a match", () => {
    expect(scheduleSearchMatches("   ", ["Any match"])).toBe(true);
  });
});
