const DAY_MS = 86_400_000;
const MAX_CACHED_DATE_FORMATTERS = 8;
const dateFormattersByTimeZone = new Map<string, Intl.DateTimeFormat>();

export function getDateKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormattersByTimeZone.get(timeZone);
  if (cached) {
    dateFormattersByTimeZone.delete(timeZone);
    dateFormattersByTimeZone.set(timeZone, cached);
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dateFormattersByTimeZone.set(timeZone, formatter);

  if (dateFormattersByTimeZone.size > MAX_CACHED_DATE_FORMATTERS) {
    const leastRecentlyUsedTimeZone = dateFormattersByTimeZone.keys().next().value;
    if (leastRecentlyUsedTimeZone !== undefined) dateFormattersByTimeZone.delete(leastRecentlyUsedTimeZone);
  }

  return formatter;
}

export function dateKeyInTimeZone(value: string | Date, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = getDateKeyFormatter(timeZone).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDaysKey(days: number, timeZone: string, now = Date.now()): string {
  return dateKeyInTimeZone(new Date(now + days * DAY_MS), timeZone);
}
