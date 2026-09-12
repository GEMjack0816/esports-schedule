export function dateKeyInTimeZone(value: string | Date, timeZone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDaysKey(days: number, timeZone: string, now = Date.now()): string {
  // Advance the visitor's calendar date, not elapsed hours: DST days can have
  // 23 or 25 hours. UTC here is only a calendar arithmetic representation.
  const calendar = new Date(`${dateKeyInTimeZone(new Date(now), timeZone)}T00:00:00.000Z`);
  calendar.setUTCDate(calendar.getUTCDate() + days);
  return dateKeyInTimeZone(calendar, "UTC");
}

export function dateInputBound(value: string | null | undefined, timeZone: string): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return dateKeyInTimeZone(value, timeZone);
}
