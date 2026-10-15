import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SCHEDULE_RESULT_ANNOUNCEMENT_DELAY_MS,
  scheduleResultAnnouncement,
  scheduleResultAnnouncementUpdate,
} from "./announcements";

afterEach(() => vi.useRealTimers());

describe("schedule result announcements", () => {
  it("announces an empty result without reading the match cards", () => {
    expect(scheduleResultAnnouncement(0)).toBe("没有符合条件的比赛。");
  });

  it("announces the number of matches matching the current filters", () => {
    expect(scheduleResultAnnouncement(1)).toBe("筛选结果：1 场比赛。");
    expect(scheduleResultAnnouncement(245)).toBe("筛选结果：245 场比赛。");
  });

  it("announces which filters are active even when two filter choices yield the same count", () => {
    expect(scheduleResultAnnouncement(4, "全部收录、英雄联盟"))
      .toBe("筛选结果：4 场比赛。当前筛选：全部收录、英雄联盟。");
    expect(scheduleResultAnnouncement(4, "全部收录、无畏契约"))
      .toBe("筛选结果：4 场比赛。当前筛选：全部收录、无畏契约。");
    expect(scheduleResultAnnouncement(4, "全部收录、英雄联盟"))
      .not.toBe(scheduleResultAnnouncement(4, "全部收录、无畏契约"));
  });

  it("includes the active filters when no matches remain", () => {
    expect(scheduleResultAnnouncement(0, "明日、CS2"))
      .toBe("没有符合条件的比赛。当前筛选：明日、CS2。");
  });

  it("coalesces rapid filter changes and announces only the final count", () => {
    vi.useFakeTimers();
    const announced: Array<{ count: number; context: string }> = [];
    const cancelOutdated = scheduleResultAnnouncementUpdate(8, "未来 7 天", (count, context) => {
      announced.push({ count, context });
    });
    cancelOutdated();
    scheduleResultAnnouncementUpdate(2, "全部收录、王者荣耀", (count, context) => {
      announced.push({ count, context });
    });

    vi.advanceTimersByTime(SCHEDULE_RESULT_ANNOUNCEMENT_DELAY_MS - 1);
    expect(announced).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(announced).toEqual([{ count: 2, context: "全部收录、王者荣耀" }]);
  });
});
