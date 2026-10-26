import { describe, expect, it, vi } from "vitest";
import { requestCompleteScheduleForSearch } from "./search-completeness";

describe("requestCompleteScheduleForSearch", () => {
  it("requests the full schedule for a non-empty query over a partial initial payload", () => {
    const loadCompleteSchedule = vi.fn(async () => true);
    expect(requestCompleteScheduleForSearch("T1", false, false, loadCompleteSchedule)).toBe(true);
    expect(loadCompleteSchedule).toHaveBeenCalledTimes(1);
  });

  it("does not load for an empty or whitespace-only query", () => {
    const loadCompleteSchedule = vi.fn(async () => true);
    expect(requestCompleteScheduleForSearch("", false, false, loadCompleteSchedule)).toBe(false);
    expect(requestCompleteScheduleForSearch("  ", false, false, loadCompleteSchedule)).toBe(false);
    expect(loadCompleteSchedule).not.toHaveBeenCalled();
  });

  it("does not reload after the full schedule is loaded or an earlier request failed", () => {
    const loadCompleteSchedule = vi.fn(async () => true);
    expect(requestCompleteScheduleForSearch("T1", true, false, loadCompleteSchedule)).toBe(false);
    expect(requestCompleteScheduleForSearch("T1", false, true, loadCompleteSchedule)).toBe(false);
    expect(loadCompleteSchedule).not.toHaveBeenCalled();
  });
});
