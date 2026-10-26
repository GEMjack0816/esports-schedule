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
