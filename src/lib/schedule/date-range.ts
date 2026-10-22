import type { EsportsMatch, MatchStatus } from "./types";

export type ScheduleDateRange = "today" | "tomorrow" | "seven" | "history" | "all";

/** Running matches are part of Today even if their start time is unknown or in the prior local day. */
export function isMatchInScheduleRange(
  status: MatchStatus,
  dateKey: string,
  range: ScheduleDateRange,
  today: string,
  tomorrow: string,
  sevenDaysOut: string,
): boolean {
  if (range === "all") return true;
  if (range === "today") return dateKey === today || status === "running";
  if (range === "tomorrow") return dateKey === tomorrow;
  if (range === "seven") return dateKey >= today && dateKey <= sevenDaysOut;
  return dateKey < today;
}

export function scheduleDateGroupKey(match: Pick<EsportsMatch, "status">, dateKey: string): string {
  return match.status === "running" ? "live" : dateKey;
}
