import type { EsportsMatch } from "./types";

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Keeps the server-to-client initial payload small while covering the next
 * seven local calendar days for every civil timezone (UTC-12 through UTC+14).
 * The extra UTC calendar day on either side accounts for timezone boundaries.
 */
export function selectInitialScheduleWindow(
  matches: EsportsMatch[],
  now = new Date(),
): EsportsMatch[] {
  const utcDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startInclusive = utcDayStart - DAY_MS;
  const endExclusive = utcDayStart + 8 * DAY_MS;

  return matches.filter((match) => {
    if (!match.startTimeUtc) return false;
    const timestamp = Date.parse(match.startTimeUtc);
    return Number.isFinite(timestamp) && timestamp >= startInclusive && timestamp < endExclusive;
  });
}
