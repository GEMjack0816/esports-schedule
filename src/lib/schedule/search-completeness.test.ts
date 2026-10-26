import { describe, expect, it, vi } from "vitest";
import {
  isMatchInSearchDateScope,
  matchesScheduleSearch,
  normalizeScheduleSearchText,
  requestCompleteScheduleForSearch,
} from "./search-completeness";

describe("schedule search text", () => {
  it("matches accented and unaccented Latin names regardless of case or Unicode composition", () => {
    expect(matchesScheduleSearch("Sao", ["São Paulo"])).toBe(true);
    expect(matchesScheduleSearch("cafe", ["Cafe\u0301 Esports"])).toBe(true);
    expect(matchesScheduleSearch("OREBRO", ["Örebro"])).toBe(true);
  });

  it("keeps non-Latin text searchable and treats an empty query as a match", () => {
    expect(matchesScheduleSearch("王者", ["王者荣耀"])).toBe(true);
    expect(matchesScheduleSearch("  ", ["any match"])).toBe(true);
    expect(normalizeScheduleSearchText("王者荣耀")).toBe("王者荣耀");
  });

  it("does not let a query made only of combining marks match every field", () => {
    expect(matchesScheduleSearch("\u0301", ["São Paulo"])).toBe(false);
    expect(matchesScheduleSearch("  \u0301  ", ["any match"])).toBe(false);
  });

  it("still requires a real substring match", () => {
    expect(matchesScheduleSearch("sao", ["São Paulo"])).toBe(true);
    expect(matchesScheduleSearch("são paulox", ["São Paulo"])).toBe(false);
  });
});

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
    expect(requestCompleteScheduleForSearch("\u0301", false, false, loadCompleteSchedule)).toBe(false);
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

  it("does not turn a query with no searchable characters into a global date search", () => {
    expect(isMatchInSearchDateScope(
      "\u0301", "", "scheduled", "2026-11-20", "today",
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
