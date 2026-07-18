import honorOfKingsData from "@/data/honor-of-kings.json";
import supplementalData from "@/data/manual-matches.json";
import { gameKeys } from "./types";
import type { EsportsMatch, GameKey, MatchStatus } from "./types";

type ManualRecord = {
  id: string;
  game: GameKey;
  scheduledAt: string;
  teams: EsportsMatch["teams"];
  league: string;
  tournament?: string | null;
  bestOf: number | null;
  scores: EsportsMatch["scores"];
  status: MatchStatus;
  streams: EsportsMatch["streams"];
  sourceUrl?: string | null;
  reviewStatus?: "approved" | "pending";
  pandascoreMatchId?: number | null;
};

type LegacyHonorOfKingsMatch = Omit<ManualRecord, "game" | "reviewStatus">;

const validStatuses: MatchStatus[] = [
  "upcoming",
  "running",
  "finished",
  "postponed",
  "canceled",
];

function isManualRecord(value: unknown): value is ManualRecord {
  if (!value || typeof value !== "object") return false;
  const match = value as Partial<ManualRecord>;
  return (
    typeof match.id === "string" &&
    gameKeys.includes(match.game as GameKey) &&
    typeof match.scheduledAt === "string" &&
    !Number.isNaN(Date.parse(match.scheduledAt)) &&
    Array.isArray(match.teams) &&
    match.teams.length === 2 &&
    match.teams.every((team) => typeof team?.name === "string") &&
    typeof match.league === "string" &&
    (match.bestOf === null || typeof match.bestOf === "number") &&
    Array.isArray(match.scores) &&
    match.scores.length === 2 &&
    Array.isArray(match.streams) &&
    validStatuses.includes(match.status as MatchStatus)
  );
}

function isLegacyHonorOfKingsMatch(value: unknown): value is LegacyHonorOfKingsMatch {
  if (!value || typeof value !== "object") return false;
  return isManualRecord({
    ...(value as object),
    game: "honor-of-kings",
  });
}

function normalizeManualMatch(match: ManualRecord, now: string): EsportsMatch {
  const id = match.pandascoreMatchId
    ? `pandascore:${match.game}:${match.pandascoreMatchId}`
    : `manual:${match.game}:${match.id}`;

  return {
    id,
    game: match.game,
    scheduledAt: new Date(match.scheduledAt).toISOString(),
    teams: [
      { ...match.teams[0], name: match.teams[0].name.trim() || "待定" },
      { ...match.teams[1], name: match.teams[1].name.trim() || "待定" },
    ],
    league: match.league.trim() || "赛事待定",
    tournament: match.tournament?.trim() || null,
    bestOf: match.bestOf && match.bestOf > 0 ? match.bestOf : null,
    scores: match.scores,
    status: match.status,
    streams: match.streams.filter((stream) => stream.url.startsWith("https://")),
    source: "manual",
    sourceUrl: match.sourceUrl || null,
    updatedAt: now,
  };
}

export function getManualMatches(now = new Date()): {
  matches: EsportsMatch[];
  honorOfKingsCount: number;
  supplementalCount: number;
} {
  const updatedAt = now.toISOString();
  const honorOfKings = (honorOfKingsData as unknown[])
    .filter(isLegacyHonorOfKingsMatch)
    .map((match) => normalizeManualMatch({
      ...match,
      game: "honor-of-kings",
      reviewStatus: "approved",
    }, updatedAt));

  const supplemental = (supplementalData.matches as unknown[])
    .filter(isManualRecord)
    .filter((match) => match.reviewStatus === "approved")
    .map((match) => normalizeManualMatch(match, updatedAt));

  return {
    matches: [...honorOfKings, ...supplemental],
    honorOfKingsCount: honorOfKings.length,
    supplementalCount: supplemental.length,
  };
}
