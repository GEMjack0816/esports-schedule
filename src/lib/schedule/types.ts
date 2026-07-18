export const gameKeys = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"] as const;

export type GameKey = (typeof gameKeys)[number];

export const pandaGameKeys = ["lol", "valorant", "cs2", "dota2"] as const;

export type PandaGameKey = (typeof pandaGameKeys)[number];

export const pandaEndpointKeys = ["upcoming", "running", "past"] as const;

export type PandaEndpointKey = (typeof pandaEndpointKeys)[number];

export type MatchStatus =
  | "upcoming"
  | "running"
  | "finished"
  | "postponed"
  | "canceled";

export type Team = {
  name: string;
  acronym?: string | null;
  logo?: string | null;
};

export type Stream = {
  label: string;
  url: string;
  official?: boolean;
};

export type EsportsMatch = {
  id: string;
  game: GameKey;
  scheduledAt: string;
  teams: [Team, Team];
  league: string;
  tournament?: string | null;
  bestOf: number | null;
  scores: [number | null, number | null];
  status: MatchStatus;
  streams: Stream[];
  source: "pandascore" | "manual" | "demo";
  sourceUrl?: string | null;
  updatedAt: string;
};

export type EndpointCoverage = {
  pages: number;
  xTotal: number;
  raw: number;
  normalized: number;
  deduplicated: number;
  final: number;
  filtered: {
    missingId: number;
    missingTime: number;
    invalidTime: number;
    outsideWindow: number;
    duplicate: number;
  };
};

export type GameCoverage = {
  endpoints: Record<PandaEndpointKey, EndpointCoverage>;
  pages: number;
  xTotal: number;
  raw: number;
  normalized: number;
  deduplicated: number;
  final: number;
  statusCounts: Record<MatchStatus, number>;
  earliestMatchAt: string | null;
  latestMatchAt: string | null;
};

export type DataCoverage = {
  mode: "live" | "demo" | "unavailable";
  stale: boolean;
  syncAttemptedAt: string;
  lastSuccessfulSyncAt: string | null;
  rateLimitRemaining: number | null;
  range: {
    pastDays: 30;
    futureDays: 60;
    earliestMatchAt: string | null;
    latestMatchAt: string | null;
  };
  totals: {
    xTotal: number;
    raw: number;
    normalized: number;
    deduplicated: number;
    finalPandaScore: number;
    finalWithManual: number;
    filtered: number;
  };
  games: Record<PandaGameKey, GameCoverage>;
  manual: {
    honorOfKings: number;
    supplemental: number;
    published: number;
  };
};

export type SchedulePayload = {
  matches: EsportsMatch[];
  generatedAt: string;
  mode: "live" | "demo" | "unavailable";
  demoMode: boolean;
  stale: boolean;
  lastSuccessfulSyncAt: string | null;
  providers: {
    pandascore: "connected" | "stale-cache" | "not-configured" | "error";
    manual: "json";
  };
  coverage: DataCoverage;
  warning?: string;
};
