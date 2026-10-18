/** Normalize user-entered schedule search text without depending on UI locale. */
export function normalizeScheduleSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0131\u0130]/g, "i")
    .toLowerCase()
    .replace(/\u00df/g, "ss")
    .replace(/\u03c2/g, "\u03c3")
    .trim()
    .replace(/\s+/g, " ");
}

export function scheduleSearchMatches(query: string, values: readonly string[]): boolean {
  return matchesNormalizedScheduleSearchText(
    normalizeScheduleSearchText(query),
    normalizeScheduleSearchValues(values),
  );
}

export function normalizeScheduleSearchValues(values: readonly string[]): string {
  return normalizeScheduleSearchText(values.join(" "));
}

export function matchesNormalizedScheduleSearchText(
  normalizedQuery: string,
  normalizedSearchText: string,
): boolean {
  if (!normalizedQuery) return true;
  return normalizedSearchText.includes(normalizedQuery);
}
