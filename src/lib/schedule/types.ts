export const gameKeys = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"] as const;

export type GameKey = (typeof gameKeys)[number];

export const pandaGameKeys = gameKeys;

export type PandaGameKey = GameKey;

export const pandaEndpointKeys = ["upcoming", "running", "past"] as const;

export type PandaEndpointKey = (typeof pandaEndpointKeys)[number];

export type MatchStatus =
  | "upcoming"
  | "running"
  | "finished"
  | "postponed"
  | "canceled"
  | "forfeit";

export type MatchProvider = "pandascore" | "manual";

export type Team = {
  name: string;
  acronym?: string | null;
  logo: string;
};

export type Stream = {
  label: string;
  url: string;
  official?: boolean;
};

export type EsportsMatch = {
  id: string;
  provider: MatchProvider;
  providerMatchId: string;
  game: GameKey;
  tournament: string | null;
  league: string;
  stage: string | null;
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number | null;
  awayScore: number | null;
  bestOf: number | null;
  status: MatchStatus;
  startTimeUtc: string | null;
  streams: Stream[];
  lastUpdatedAt: string;
  sourceUrl?: string | null;
  manualOverride?: boolean;
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

export type GameSyncStatus = "normal" | "delayed" | "failed";

export type ProviderVerificationSample = {
  providerMatchId: string;
  endpoint: PandaEndpointKey;
  providerTournament: string;
  providerStartTimeUtc: string | null;
  normalizedTournament: string;
  normalizedStartTimeUtc: string | null;
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
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  syncStatus: GameSyncStatus;
  staleMinutes: number | null;
  dataSource: "fresh" | "cache" | "unavailable";
  lastErrorCode: string | null;
  verificationSample?: ProviderVerificationSample | null;
};

export type DataCoverage = {
  mode: "live" | "unavailable";
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
    overrides: number;
    hidden: number;
    published: number;
  };
};

export type SchedulePayload = {
  matches: EsportsMatch[];
  generatedAt: string;
  mode: "live" | "unavailable";
  demoMode: boolean;
  stale: boolean;
  lastSuccessfulSyncAt: string | null;
  providers: {
    pandascore: "connected" | "stale-cache" | "not-configured" | "error";
    manual: "json";
  };
  coverage: DataCoverage;
  deployment: {
    id: string | null;
    commitSha: string | null;
    productionUrl: string | null;
    environment: string | null;
  };
  warning?: string;
};
