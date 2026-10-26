import { describe, expect, it, vi } from "vitest";
import { isMatchInSearchDateScope, requestCompleteScheduleForSearch } from "./search-completeness";

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

describe("isMatchInSearchDateScope", () => {
  const dates = {
    today: "2026-10-27",
    tomorrow: "2026-10-28",
    sevenDaysOut: "2026-11-02",
  };

  it("searches future and historical matches beyond the active quick range", () => {
    expect(isMatchInSearchDateScope(
      "T1", "", "scheduled", "2026-11-20", "today",
      dates.today, dates.tomorrow, dates.sevenDaysOut,
    )).toBe(true);
    expect(isMatchInSearchDateScope(
      "T1", "", "finished", "2026-09-01", "today",
      dates.today, dates.tomorrow, dates.sevenDaysOut,
    )).toBe(true);
  });

  it("keeps quick-range filtering when there is no search query", () => {
    expect(isMatchInSearchDateScope(
      "  ", "", "scheduled", "2026-11-20", "today",
      dates.today, dates.tomorrow, dates.sevenDaysOut,
    )).toBe(false);
  });

  it("respects an explicitly selected date even during global search", () => {
    expect(isMatchInSearchDateScope(
      "T1", "2026-11-20", "scheduled", "2026-11-20", "today",
      dates.today, dates.tomorrow, dates.sevenDaysOut,
    )).toBe(true);
    expect(isMatchInSearchDateScope(
      "T1", "2026-11-20", "scheduled", "2026-11-21", "today",
      dates.today, dates.tomorrow, dates.sevenDaysOut,
    )).toBe(false);
  });
});
