export const gameKeys = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"] as const;

export type GameKey = (typeof gameKeys)[number];

export const pandaGameKeys = gameKeys;

export type PandaGameKey = GameKey;

export const pandaEndpointKeys = ["upcoming", "running", "past"] as const;

export type PandaEndpointKey = (typeof pandaEndpointKeys)[number];

export type MatchStatus =
  | "scheduled"
  | "running"
  | "finished"
  | "postponed"
  | "cancelled"
  | "forfeit"
  | "unknown";

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
  /** Monotonic PandaScore snapshot version used to reject stale client refresh responses. */
  syncGeneration?: number | null;
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
  sourceFetchedAt: string | null;
  snapshotAgeSeconds: number | null;
  refreshInProgress: boolean;
  syncStatus: GameSyncStatus;
  staleMinutes: number | null;
  dataSource: "fresh" | "cache" | "persistent" | "unavailable";
  lastErrorCode: string | null;
  lastError: SyncErrorInfo | null;
  verificationSample?: ProviderVerificationSample | null;
};

export type SyncErrorInfo = {
  at: string;
  code: string;
  httpStatus: number | null;
};

export type DataCoverage = {
  mode: "live" | "unavailable";
  stale: boolean;
  syncAttemptedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  sourceFetchedAt: string | null;
  snapshotAgeSeconds: number | null;
  refreshInProgress: boolean;
  lastError: SyncErrorInfo | null;
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
    database: number;
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
    manual: "json+database";
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
