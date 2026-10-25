const DAY_MS = 86_400_000;

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

export function dateInputBoundsInTimeZone(
  earliestMatchAt: string | null,
  latestMatchAt: string | null,
  timeZone: string,
): { min?: string; max?: string } {
  const toLocalDate = (value: string | null) => {
    if (!value) return undefined;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
      ? dateKeyInTimeZone(new Date(timestamp), timeZone)
      : undefined;
  };

  return {
    min: toLocalDate(earliestMatchAt),
    max: toLocalDate(latestMatchAt),
  };
}

export function addDaysKey(days: number, timeZone: string, now = Date.now()): string {
  return dateKeyInTimeZone(new Date(now + days * DAY_MS), timeZone);
}
