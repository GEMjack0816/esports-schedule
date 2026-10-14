import type { EsportsMatch } from "./types";
import type { ScheduleRangeKey } from "./page-types";
import { dateKeyInTimeZone } from "./time";

export type GroupedScheduleMatches = [string, EsportsMatch[]][];

export function groupScheduleMatches(
  matches: EsportsMatch[],
  timeZone: string,
  range: ScheduleRangeKey,
): GroupedScheduleMatches {
  const groups = new Map<string, EsportsMatch[]>();
  for (const match of matches) {
    const key = match.startTimeUtc ? dateKeyInTimeZone(match.startTimeUtc, timeZone) : "unscheduled";
    const group = groups.get(key);
    if (group) group.push(match);
    else groups.set(key, [match]);
  }

  return [...groups.entries()].sort(([a], [b]) => {
    if (a === "unscheduled") return 1;
    if (b === "unscheduled") return -1;
    return range === "history" ? b.localeCompare(a) : a.localeCompare(b);
  });
}
