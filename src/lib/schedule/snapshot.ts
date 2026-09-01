import type { PandaGameSnapshot } from "./pandascore";
import { normalizeStoredMatchStatus } from "./status";
import type { EsportsMatch, MatchStatus, PandaGameKey, Team } from "./types";

function isTeam(value: unknown): value is Team {
  if (!value || typeof value !== "object") return false;
  const team = value as Partial<Team>;
  return typeof team.name === "string" && typeof team.logo === "string";
}

function normalizeStoredMatch(value: unknown, game: PandaGameKey): EsportsMatch | null {
  if (!value || typeof value !== "object") return null;
  const match = value as Partial<EsportsMatch>;
  const status = normalizeStoredMatchStatus(match.status);
  const startTimeValid = match.startTimeUtc === null
    || (typeof match.startTimeUtc === "string" && !Number.isNaN(Date.parse(match.startTimeUtc)));
  if (
    typeof match.id !== "string"
    || match.provider !== "pandascore"
    || typeof match.providerMatchId !== "string"
    || match.game !== game
    || typeof match.league !== "string"
    || !isTeam(match.homeTeam)
    || !isTeam(match.awayTeam)
    || !Array.isArray(match.streams)
    || typeof match.lastUpdatedAt !== "string"
    || Number.isNaN(Date.parse(match.lastUpdatedAt))
    || !startTimeValid
    || !status
  ) {
    return null;
  }
  return { ...(match as EsportsMatch), status };
}

export function normalizePandaGameSnapshot(
  value: unknown,
  game: PandaGameKey,
): PandaGameSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<PandaGameSnapshot>;
  const generationValid = stored.syncGeneration === undefined
    || (typeof stored.syncGeneration === "number"
      && Number.isSafeInteger(stored.syncGeneration)
      && stored.syncGeneration > 0);
  if (
    stored.game !== game
    || !Array.isArray(stored.matches)
    || typeof stored.fetchedAt !== "string"
    || Number.isNaN(Date.parse(stored.fetchedAt))
    || !stored.coverage
    || typeof stored.coverage !== "object"
    || !stored.coverage.endpoints
    || !generationValid
  ) {
    return null;
  }

  const matches = stored.matches.map((match) => normalizeStoredMatch(match, game));
  if (matches.some((match) => match === null)) return null;
  const normalizedMatches = matches as EsportsMatch[];
  const statusCounts: Record<MatchStatus, number> = {
    scheduled: 0,
    running: 0,
    finished: 0,
    postponed: 0,
    cancelled: 0,
    forfeit: 0,
    unknown: 0,
  };
  for (const match of normalizedMatches) statusCounts[match.status] += 1;

  return {
    ...(stored as PandaGameSnapshot),
    matches: normalizedMatches,
    coverage: {
      ...stored.coverage,
      statusCounts,
    },
  };
}
