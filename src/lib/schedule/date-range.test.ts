import { describe, expect, it } from "vitest";
import { isMatchInScheduleRange, isMatchOnSelectedDate, scheduleDateGroupKey } from "./date-range";

const today = "2026-10-22";
const tomorrow = "2026-10-23";
const sevenDaysOut = "2026-10-28";

describe("isMatchInScheduleRange", () => {
  it("keeps a running match with unknown start time in Today", () => {
    expect(isMatchInScheduleRange("running", "unscheduled", "today", today, tomorrow, sevenDaysOut)).toBe(true);
  });

  it("keeps a running match that crossed local midnight in Today", () => {
    expect(isMatchInScheduleRange("running", "2026-10-21", "today", today, tomorrow, sevenDaysOut)).toBe(true);
  });

  it("does not treat an unscheduled non-running match as today's fixture", () => {
    expect(isMatchInScheduleRange("scheduled", "unscheduled", "today", today, tomorrow, sevenDaysOut)).toBe(false);
  });

  it("does not leak live matches into tomorrow, seven-day, or history ranges", () => {
    expect(isMatchInScheduleRange("running", "unscheduled", "tomorrow", today, tomorrow, sevenDaysOut)).toBe(false);
    expect(isMatchInScheduleRange("running", "unscheduled", "seven", today, tomorrow, sevenDaysOut)).toBe(false);
    expect(isMatchInScheduleRange("running", "unscheduled", "history", today, tomorrow, sevenDaysOut)).toBe(false);
    expect(isMatchInScheduleRange("running", "2026-10-21", "history", today, tomorrow, sevenDaysOut)).toBe(false);
    expect(isMatchInScheduleRange("running", today, "seven", today, tomorrow, sevenDaysOut)).toBe(false);
    expect(isMatchInScheduleRange("running", tomorrow, "tomorrow", today, tomorrow, sevenDaysOut)).toBe(false);
  });

  it("preserves calendar range semantics for scheduled and finished fixtures", () => {
    expect(isMatchInScheduleRange("scheduled", today, "today", today, tomorrow, sevenDaysOut)).toBe(true);
    expect(isMatchInScheduleRange("scheduled", tomorrow, "today", today, tomorrow, sevenDaysOut)).toBe(false);
    expect(isMatchInScheduleRange("finished", "2026-10-21", "history", today, tomorrow, sevenDaysOut)).toBe(true);
  });
});

describe("scheduleDateGroupKey", () => {
  it("groups running matches under an explicit live heading", () => {
    expect(scheduleDateGroupKey({ status: "running" }, "unscheduled")).toBe("live");
    expect(scheduleDateGroupKey({ status: "running" }, "2026-10-21")).toBe("live");
  });

  it("keeps non-running matches grouped by local date", () => {
    expect(scheduleDateGroupKey({ status: "scheduled" }, today)).toBe(today);
    expect(scheduleDateGroupKey({ status: "scheduled" }, "unscheduled")).toBe("unscheduled");
  });
});

describe("isMatchOnSelectedDate", () => {
  it("keeps undated and prior-local-day running matches when Today is selected", () => {
    expect(isMatchOnSelectedDate("running", "unscheduled", today, today)).toBe(true);
    expect(isMatchOnSelectedDate("running", "2026-10-21", today, today)).toBe(true);
  });

  it("keeps non-running matches tied to the selected calendar date", () => {
    expect(isMatchOnSelectedDate("scheduled", today, today, today)).toBe(true);
    expect(isMatchOnSelectedDate("scheduled", tomorrow, today, today)).toBe(false);
  });

  it("excludes running matches when another date is selected", () => {
    expect(isMatchOnSelectedDate("running", tomorrow, tomorrow, today)).toBe(false);
    expect(isMatchOnSelectedDate("running", "unscheduled", tomorrow, today)).toBe(false);
  });
});
