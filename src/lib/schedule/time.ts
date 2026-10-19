const DAY_MS = 86_400_000;

/** A compact location label derived from an IANA time-zone identifier. */
export function timeZoneLocationLabel(timeZone: string): string {
  const location = timeZone.split("/").at(-1)?.replaceAll("_", " ");
  return location && location !== "UTC" && location !== "GMT" ? location : "UTC";
}

/** Returns the current UTC offset for a zone, including half/quarter-hour zones. */
export function timeZoneUtcOffset(timeZone: string, instant = new Date()): string {
  try {
    const offset = new Intl.DateTimeFormat("en", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
    if (!offset || offset === "GMT" || offset === "UTC") return "UTC+00:00";

    const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(offset);
    if (!match) return "UTC+00:00";

    const [, sign, hours, minutes = "00"] = match;
    return `UTC${sign}${hours.padStart(2, "0")}:${minutes}`;
  } catch {
    return "UTC+00:00";
  }
}

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
  return dateKeyInTimeZone(new Date(now + days * DAY_MS), timeZone);
}
