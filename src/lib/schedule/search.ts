/** Normalize user-entered schedule search text without depending on UI locale. */
export function normalizeScheduleSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0131\u0130]/g, "i")
    .toLowerCase()
    .replace(/\u00df/g, "ss")
    .trim()
    .replace(/\s+/g, " ");
}

export function scheduleSearchMatches(query: string, values: readonly string[]): boolean {
  return scheduleSearchMatchesNormalized(normalizeScheduleSearchText(query), values);
}

export function scheduleSearchMatchesNormalized(
  normalizedQuery: string,
  values: readonly string[],
): boolean {
  if (!normalizedQuery) return true;

  const normalizedValues = normalizeScheduleSearchText(values.join(" "));
  return normalizedValues.includes(normalizedQuery);
}
