import { gameKeys } from "./types";
import type { GameKey, MatchStatus } from "./types";

export const scheduleRangeKeys = ["today", "tomorrow", "seven", "history", "all"] as const;
export type ScheduleRangeKey = (typeof scheduleRangeKeys)[number];

export type ScheduleFilters = {
  range: ScheduleRangeKey;
  game: GameKey | "all";
  league: string;
  status: MatchStatus | "all";
  query: string;
  selectedDate: string;
};

export const DEFAULT_SCHEDULE_FILTERS: ScheduleFilters = {
  range: "today",
  game: "all",
  league: "all",
  status: "all",
  query: "",
  selectedDate: "",
};

const filterParameterNames = ["range", "game", "league", "status", "q", "date"] as const;
const matchStatuses: readonly MatchStatus[] = [
  "scheduled",
  "running",
  "finished",
  "postponed",
  "cancelled",
  "forfeit",
  "unknown",
];

function isCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function parseScheduleFilters(params: URLSearchParams): ScheduleFilters {
  const rawRange = params.get("range");
  const rawGame = params.get("game");
  const rawStatus = params.get("status");
  const rawLeague = params.get("league");
  const rawQuery = params.get("q");

  return {
    range: scheduleRangeKeys.includes(rawRange as ScheduleRangeKey)
      ? rawRange as ScheduleRangeKey
      : DEFAULT_SCHEDULE_FILTERS.range,
    game: rawGame === "all" || !rawGame
      ? "all"
      : gameKeys.includes(rawGame as GameKey) ? rawGame as GameKey : "all",
    league: rawLeague && rawLeague !== "all" ? rawLeague.slice(0, 120) : "all",
    status: rawStatus === "all" || !rawStatus
      ? "all"
      : matchStatuses.includes(rawStatus as MatchStatus) ? rawStatus as MatchStatus : "all",
    query: rawQuery?.trim().slice(0, 120) ?? "",
    selectedDate: isCalendarDate(params.get("date")) ? params.get("date")! : "",
  };
}

export function applyScheduleFilters(
  current: URLSearchParams,
  filters: ScheduleFilters,
): URLSearchParams {
  const params = new URLSearchParams(current);
  for (const name of filterParameterNames) params.delete(name);

  if (filters.range !== DEFAULT_SCHEDULE_FILTERS.range) params.set("range", filters.range);
  if (filters.game !== "all") params.set("game", filters.game);
  if (filters.league !== "all") params.set("league", filters.league.slice(0, 120));
  if (filters.status !== "all") params.set("status", filters.status);
  const query = filters.query.trim().slice(0, 120);
  if (query) params.set("q", query);
  if (isCalendarDate(filters.selectedDate)) params.set("date", filters.selectedDate);

  return params;
}
