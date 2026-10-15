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

  it("coalesces rapid filter changes and announces only the final count", () => {
    vi.useFakeTimers();
    const announced: number[] = [];
    const cancelOutdated = scheduleResultAnnouncementUpdate(8, (count) => announced.push(count));
    cancelOutdated();
    scheduleResultAnnouncementUpdate(2, (count) => announced.push(count));

    vi.advanceTimersByTime(SCHEDULE_RESULT_ANNOUNCEMENT_DELAY_MS - 1);
    expect(announced).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(announced).toEqual([2]);
  });
});
