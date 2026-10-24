import type { EsportsMatch } from "./types";

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Keeps the server-to-client initial payload small while covering the next
 * seven local calendar days for every civil timezone (UTC-12 through UTC+14).
 * The extra UTC calendar day on either side accounts for timezone boundaries.
 * Running matches stay in the initial payload regardless of timestamp/window
 * so the Today view can always surface active matches, including undated ones.
 */
export function selectInitialScheduleWindow(
  matches: EsportsMatch[],
  now = new Date(),
): EsportsMatch[] {
  const utcDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startInclusive = utcDayStart - DAY_MS;
  const endExclusive = utcDayStart + 8 * DAY_MS;

  return matches.filter((match) => {
    if (!match.startTimeUtc) return match.status === "running";
    const timestamp = Date.parse(match.startTimeUtc);
    if (!Number.isFinite(timestamp)) return false;
    if (match.status === "running") return true;
    return timestamp >= startInclusive && timestamp < endExclusive;
  });
}
