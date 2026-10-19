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
  const [year, month, day] = dateKeyInTimeZone(new Date(now), timeZone).split("-").map(Number);
  const target = new Date(0);
  target.setUTCFullYear(year, month - 1, day + days);
  target.setUTCHours(0, 0, 0, 0);
  return dateKeyInTimeZone(target, "UTC");
}

export function dateRangeBoundsInTimeZone(
  earliestMatchAt: string | null,
  latestMatchAt: string | null,
  timeZone: string,
): { min: string | undefined; max: string | undefined } {
  return {
    min: earliestMatchAt ? dateKeyInTimeZone(earliestMatchAt, timeZone) : undefined,
    max: latestMatchAt ? dateKeyInTimeZone(latestMatchAt, timeZone) : undefined,
  };
}
