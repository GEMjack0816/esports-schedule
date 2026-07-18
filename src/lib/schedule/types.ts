export const gameKeys = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"] as const;

export type GameKey = (typeof gameKeys)[number];

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
  bestOf: number;
  scores: [number | null, number | null];
  status: MatchStatus;
  streams: Stream[];
  source: "pandascore" | "manual" | "demo";
  updatedAt: string;
};

export type SchedulePayload = {
  matches: EsportsMatch[];
  generatedAt: string;
  mode: "live" | "demo";
  providers: {
    pandascore: "connected" | "not-configured" | "error";
    honorOfKings: "manual-json";
  };
  warning?: string;
};
