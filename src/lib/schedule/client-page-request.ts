import type { SchedulePageQuery } from "./page-types";

type SchedulePageIdentity = Pick<
  SchedulePageQuery,
  "range" | "timeZone" | "game" | "league" | "status" | "query" | "selectedDate"
>;

export function schedulePageRequestKey(query: SchedulePageIdentity): string {
  return JSON.stringify([
    query.range,
    query.timeZone,
    query.game,
    query.league,
    query.status,
    query.query.trim(),
    query.selectedDate,
  ]);
}

export function isCurrentSchedulePageRequest(
  requestSerial: number,
  currentSerial: number,
  requestKey: string,
  currentRequestKey: string,
): boolean {
  return requestSerial === currentSerial && requestKey === currentRequestKey;
}

export function isSchedulePageForCurrentFilters(
  loadedRequestKey: string,
  currentRequestKey: string,
): boolean {
  return loadedRequestKey === currentRequestKey;
}
