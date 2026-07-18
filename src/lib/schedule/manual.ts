import honorOfKingsData from "@/data/honor-of-kings.json";
import type { EsportsMatch, MatchStatus } from "./types";

type ManualMatch = Omit<EsportsMatch, "game" | "source" | "updatedAt">;

function isManualMatch(match: unknown): match is ManualMatch {
  if (!match || typeof match !== "object") return false;
  const value = match as Partial<ManualMatch>;
  return (
    typeof value.id === "string" &&
    typeof value.scheduledAt === "string" &&
    Array.isArray(value.teams) &&
    value.teams.length === 2 &&
    typeof value.league === "string" &&
    typeof value.bestOf === "number" &&
    Array.isArray(value.scores) &&
    Array.isArray(value.streams) &&
    ["upcoming", "running", "finished", "postponed", "canceled"].includes(
      value.status as MatchStatus,
    )
  );
}

export function getHonorOfKingsMatches(): EsportsMatch[] {
  const updatedAt = new Date().toISOString();

  return (honorOfKingsData as unknown[])
    .filter(isManualMatch)
    .map((match) => ({
      ...match,
      game: "honor-of-kings" as const,
      source: "manual" as const,
      updatedAt,
    }));
}
