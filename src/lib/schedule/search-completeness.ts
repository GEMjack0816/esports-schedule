import { isMatchInScheduleRange, isMatchOnSelectedDate, type ScheduleDateRange } from "./date-range";
import type { MatchStatus } from "./types";

/**
 * A non-empty search is global, so it must not silently search only the
 * initial SSR window. Fetch the full schedule once before presenting results.
 */
export function requestCompleteScheduleForSearch(
  query: string,
  completeScheduleLoaded: boolean,
  completeScheduleError: boolean,
  loadCompleteSchedule: () => Promise<boolean>,
): boolean {
  if (completeScheduleLoaded || completeScheduleError || query.trim().length === 0) return false;
  void loadCompleteSchedule();
  return true;
}

/**
 * A global search spans all dates unless the user explicitly selected a date.
 * Without a query, preserve the current quick-range behavior.
 */
export function isMatchInSearchDateScope(
  query: string,
  selectedDate: string,
  status: MatchStatus,
  dateKey: string,
  range: ScheduleDateRange,
  today: string,
  tomorrow: string,
  sevenDaysOut: string,
): boolean {
  if (selectedDate) return isMatchOnSelectedDate(status, dateKey, selectedDate, today);
  if (query.trim()) return true;
  return isMatchInScheduleRange(status, dateKey, range, today, tomorrow, sevenDaysOut);
}
