import { isMatchInScheduleRange, isMatchOnSelectedDate, type ScheduleDateRange } from "./date-range";
import type { MatchStatus } from "./types";

/** Make search tolerant of accents while preserving non-Latin characters. */
export function normalizeScheduleSearchText(value: string): string {
  let normalized = "";
  let hasBaseCharacter = false;
  let previousBaseIsLatin = false;

  for (const character of value.normalize("NFD")) {
    if (/\p{M}/u.test(character)) {
      // Drop combining marks only when they modify a Latin base character.
      // Marks are meaningful in many other scripts and must remain searchable.
      if (hasBaseCharacter && !previousBaseIsLatin) normalized += character;
      continue;
    }

    normalized += character;
    hasBaseCharacter = !/\s/u.test(character);
    previousBaseIsLatin = hasBaseCharacter && /\p{Script=Latin}/u.test(character);
  }

  return normalized.toLowerCase();
}

export function hasEffectiveScheduleSearch(query: string): boolean {
  return normalizeScheduleSearchText(query.trim()).length > 0;
}

export function matchesScheduleSearch(query: string, fields: readonly string[]): boolean {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return true;

  const normalizedQuery = normalizeScheduleSearchText(trimmedQuery);
  return normalizedQuery.length > 0
    && fields.some((field) => normalizeScheduleSearchText(field).includes(normalizedQuery));
}

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
  if (completeScheduleLoaded || completeScheduleError || !hasEffectiveScheduleSearch(query)) return false;
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
  if (hasEffectiveScheduleSearch(query)) return true;
  return isMatchInScheduleRange(status, dateKey, range, today, tomorrow, sevenDaysOut);
}
