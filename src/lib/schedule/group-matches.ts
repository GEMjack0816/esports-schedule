import type { EsportsMatch } from "./types";
import { dateKeyInTimeZone } from "./time";

export function matchDateKey(match: EsportsMatch, timeZone: string): string {
  return match.startTimeUtc ? dateKeyInTimeZone(match.startTimeUtc, timeZone) : "unscheduled";
}

export function groupMatchesByDate(
  matches: readonly EsportsMatch[],
  timeZone: string,
  newestDateFirst = false,
): Array<[string, EsportsMatch[]]> {
  const groups = new Map<string, EsportsMatch[]>();

  for (const match of matches) {
    const key = matchDateKey(match, timeZone);
    const group = groups.get(key);
    if (group) group.push(match);
    else groups.set(key, [match]);
  }

  return [...groups.entries()].sort(([left], [right]) => {
    if (left === "unscheduled") return 1;
    if (right === "unscheduled") return -1;
    return newestDateFirst ? right.localeCompare(left) : left.localeCompare(right);
  });
}
