import { dateKeyInTimeZone } from "./time";
import type { EsportsMatch } from "./types";

export type ScheduleDateGroups = Array<[string, EsportsMatch[]]>;

export function groupMatchesByDate(
  matches: EsportsMatch[],
  timeZone: string,
  order: "ascending" | "descending" = "ascending",
): ScheduleDateGroups {
  const groups = new Map<string, EsportsMatch[]>();

  for (const match of matches) {
    const timestamp = match.startTimeUtc ? Date.parse(match.startTimeUtc) : Number.NaN;
    const key = Number.isNaN(timestamp)
      ? "unscheduled"
      : dateKeyInTimeZone(new Date(timestamp), timeZone);
    const group = groups.get(key);
    if (group) group.push(match);
    else groups.set(key, [match]);
  }

  return [...groups.entries()].sort(([left], [right]) => {
    if (left === "unscheduled") return 1;
    if (right === "unscheduled") return -1;
    return order === "descending"
      ? right.localeCompare(left)
      : left.localeCompare(right);
  });
}
