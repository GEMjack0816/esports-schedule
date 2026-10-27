import type { EsportsMatch, GameKey, MatchStatus, SchedulePayload } from "./types";

export type ScheduleRangeKey = "today" | "tomorrow" | "seven" | "history" | "all";

export type SchedulePageQuery = {
  range: ScheduleRangeKey;
  timeZone: string;
  game: GameKey | "all";
  league: string | "all";
  status: MatchStatus | "all";
  query: string;
  selectedDate: string | null;
  cursor: string | null;
  limit: number;
};

export type SchedulePageData = Omit<SchedulePayload, "matches"> & {
  matches: EsportsMatch[];
  page: {
    limit: number;
    nextCursor: string | null;
    total: number;
  };
  rangeCounts: Record<ScheduleRangeKey, number>;
  liveCount: number;
  upcomingCount: number;
  leagues: string[];
  timeZone: string;
};

export type SchedulePageQueryFilters = Omit<SchedulePageQuery, "cursor">;
