import { SubmissionValidationError } from "@/lib/submissions";

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const zonedDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function hasValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/**
 * Admin datetime-local controls are deliberately expressed in UTC. The HTML
 * control omits a timezone, so convert its components explicitly instead of
 * letting the Node/browser runtime timezone decide what instant they mean.
 */
export function normalizeUtcDateTimeInput(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const normalized = value.trim();
  const localMatch = localDateTimePattern.exec(normalized);

  if (localMatch) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", millisecondText = "0"] = localMatch;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const millisecond = Number(millisecondText.padEnd(3, "0"));
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, millisecond);

    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
      || date.getUTCHours() !== hour
      || date.getUTCMinutes() !== minute
      || date.getUTCSeconds() !== second
      || date.getUTCMilliseconds() !== millisecond
    ) {
      throw new SubmissionValidationError("比赛时间格式无效。");
    }

    return date.toISOString();
  }

  if (!zonedDateTimePattern.test(normalized)) {
    throw new SubmissionValidationError("比赛时间格式无效。");
  }

  const [yearText, monthText, dayText] = normalized.slice(0, 10).split("-");
  if (!hasValidCalendarDate(Number(yearText), Number(monthText), Number(dayText))) {
    throw new SubmissionValidationError("比赛时间格式无效。");
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new SubmissionValidationError("比赛时间格式无效。");
  return date.toISOString();
}

export function utcDateTimeLocalValue(value: Date | string | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString();
  const minutes = iso.slice(0, 16);
  const secondsAndMilliseconds = iso.slice(17, 23);
  return secondsAndMilliseconds === "00.000"
    ? minutes
    : `${minutes}:${iso.slice(17, 19)}${date.getUTCMilliseconds() === 0 ? "" : iso.slice(19, 23)}`;
}
