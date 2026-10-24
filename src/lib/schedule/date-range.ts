import type { EsportsMatch, MatchStatus } from "./types";

export type ScheduleDateRange = "today" | "tomorrow" | "seven" | "history" | "all";

/** Keep active fixtures visible in Today even if their start time is unknown or rolled over from an earlier local date. */
export function isMatchInScheduleRange(
  status: MatchStatus,
  dateKey: string,
  range: ScheduleDateRange,
  today: string,
  tomorrow: string,
  sevenDaysOut: string,
): boolean {
  if (range === "all") return true;
  if (status === "running") return range === "today";
  if (range === "today") return dateKey === today;
  if (range === "tomorrow") return dateKey === tomorrow;
  if (range === "seven") return dateKey >= today && dateKey <= sevenDaysOut;
  return dateKey < today;
}

/** A manually selected Today date still includes active matches with missing or earlier local dates. */
export function isMatchOnSelectedDate(
  status: MatchStatus,
  dateKey: string,
  selectedDate: string,
  today: string,
): boolean {
  if (status === "running") return selectedDate === today;
  return dateKey === selectedDate;
}

export function scheduleDateGroupKey(match: Pick<EsportsMatch, "status">, dateKey: string): string {
  return match.status === "running" ? "live" : dateKey;
}
