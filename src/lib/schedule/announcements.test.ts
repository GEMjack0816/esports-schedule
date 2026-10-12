import { describe, expect, it } from "vitest";
import { scheduleResultAnnouncement } from "./announcements";

describe("schedule result announcements", () => {
  it("announces an empty result without reading the match cards", () => {
    expect(scheduleResultAnnouncement(0)).toBe("没有符合条件的比赛。");
  });

  it("announces the number of matches matching the current filters", () => {
    expect(scheduleResultAnnouncement(1)).toBe("筛选结果：1 场比赛。");
    expect(scheduleResultAnnouncement(245)).toBe("筛选结果：245 场比赛。");
  });
});
