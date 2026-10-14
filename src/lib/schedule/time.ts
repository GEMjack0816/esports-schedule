const DAY_MS = 86_400_000;
// Keep warm workers from retaining formatter instances for arbitrary timezones forever.
const MAX_DATE_KEY_FORMATTERS = 8;
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

export function getDateKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateKeyFormatters.get(timeZone);
  if (cached) {
    dateKeyFormatters.delete(timeZone);
    dateKeyFormatters.set(timeZone, cached);
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dateKeyFormatters.set(timeZone, formatter);

  if (dateKeyFormatters.size > MAX_DATE_KEY_FORMATTERS) {
    const leastRecentlyUsed = dateKeyFormatters.keys().next().value;
    if (leastRecentlyUsed !== undefined) dateKeyFormatters.delete(leastRecentlyUsed);
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
