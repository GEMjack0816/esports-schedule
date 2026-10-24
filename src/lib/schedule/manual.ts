import honorOfKingsData from "../../data/honor-of-kings.json";
import supplementalData from "../../data/manual-matches.json";
import { gameKeys } from "./types";
import { normalizeStoredMatchStatus } from "./status";
import type {
  EsportsMatch,
  GameKey,
  MatchProvider,
  Stream,
  Team,
} from "./types";
import { uniqueAndSort } from "./utils";

type LegacyTeam = Omit<Partial<Team>, "name"> & { name: string };

type ManualRecord = {
  id: string;
  game: GameKey;
  startTimeUtc?: string | null;
  scheduledAt?: string | null;
  homeTeam?: LegacyTeam;
  awayTeam?: LegacyTeam;
  teams?: [LegacyTeam, LegacyTeam];
  league: string;
  tournament?: string | null;
  stage?: string | null;
  bestOf: number | null;
  homeScore?: number | null;
  awayScore?: number | null;
  scores?: [number | null, number | null];
  status: string;
  streams: Stream[];
  sourceUrl?: string | null;
  reviewStatus?: "approved" | "pending";
  pandascoreMatchId?: number | string | null;
};

type ManualOverrideChanges = {
  startTimeUtc?: string | null;
  status?: string;
  homeTeam?: Partial<Team>;
  awayTeam?: Partial<Team>;
  league?: string;
  tournament?: string | null;
  stage?: string | null;
  bestOf?: number | null;
  homeScore?: number | null;
  awayScore?: number | null;
  streams?: Stream[];
  sourceUrl?: string | null;
};

type ManualOverride = {
  id: string;
  provider: MatchProvider;
  providerMatchId: string;
  game: GameKey;
  reviewStatus: "approved" | "pending";
  hidden?: boolean;
  changes?: ManualOverrideChanges;
};

type LegacyHonorOfKingsMatch = Omit<ManualRecord, "game" | "reviewStatus">;

function validTime(value: string | null | undefined): boolean {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function isManualRecord(value: unknown): value is ManualRecord {
  if (!value || typeof value !== "object") return false;
  const match = value as Partial<ManualRecord>;
  const teams = match.teams ?? (match.homeTeam && match.awayTeam ? [match.homeTeam, match.awayTeam] : null);
  const start = match.startTimeUtc ?? match.scheduledAt ?? null;
  return (
    typeof match.id === "string"
    && gameKeys.includes(match.game as GameKey)
    && validTime(start)
    && Array.isArray(teams)
    && teams.length === 2
    && teams.every((team) => typeof team?.name === "string")
    && typeof match.league === "string"
    && (match.bestOf === null || typeof match.bestOf === "number")
    && Array.isArray(match.streams)
    && normalizeStoredMatchStatus(match.status) !== null
  );
}

function isLegacyHonorOfKingsMatch(value: unknown): value is LegacyHonorOfKingsMatch {
  if (!value || typeof value !== "object") return false;
  return isManualRecord({ ...(value as object), game: "honor-of-kings" });
}

function isManualOverride(value: unknown): value is ManualOverride {
  if (!value || typeof value !== "object") return false;
  const override = value as Partial<ManualOverride>;
  return typeof override.id === "string"
    && typeof override.provider === "string"
    && typeof override.providerMatchId === "string"
    && gameKeys.includes(override.game as GameKey)
    && (override.reviewStatus === "approved" || override.reviewStatus === "pending")
    && (!override.changes?.status || normalizeStoredMatchStatus(override.changes.status) !== null)
    && (override.changes?.startTimeUtc === undefined || validTime(override.changes.startTimeUtc));
}

function normalizeTeam(team: LegacyTeam | undefined): Team {
  return {
    name: team?.name?.trim() || "待定",
    acronym: team?.acronym?.trim() || null,
    logo: team?.logo || "/team-placeholder.svg",
  };
}

function safeStreams(streams: Stream[] | undefined): Stream[] {
  return (streams ?? []).filter((stream) => stream.url.startsWith("https://"));
}

function normalizeManualMatch(match: ManualRecord, now: string): EsportsMatch {
  const provider = match.pandascoreMatchId ? "pandascore" : "manual";
  const providerMatchId = match.pandascoreMatchId ? String(match.pandascoreMatchId) : match.id;
  const teams = match.teams ?? [match.homeTeam ?? { name: "待定" }, match.awayTeam ?? { name: "待定" }];
  const scores = match.scores ?? [match.homeScore ?? null, match.awayScore ?? null];
  const start = match.startTimeUtc ?? match.scheduledAt ?? null;

  return {
    id: provider === "pandascore"
      ? `pandascore:${match.game}:${providerMatchId}`
      : `manual:${match.game}:${providerMatchId}`,
    provider,
    providerMatchId,
    game: match.game,
    tournament: match.tournament?.trim() || null,
    league: match.league.trim() || "赛事待定",
    stage: match.stage?.trim() || null,
    homeTeam: normalizeTeam(teams[0]),
    awayTeam: normalizeTeam(teams[1]),
    homeScore: scores[0],
    awayScore: scores[1],
    bestOf: match.bestOf && match.bestOf > 0 ? match.bestOf : null,
    status: normalizeStoredMatchStatus(match.status) ?? "unknown",
    startTimeUtc: start ? new Date(start).toISOString() : null,
    streams: safeStreams(match.streams),
    lastUpdatedAt: now,
    sourceUrl: match.sourceUrl || null,
    manualOverride: provider === "pandascore",
  };
}

function applyTeamChanges(current: Team, changes: Partial<Team> | undefined): Team {
  if (!changes) return current;
  return {
    ...current,
    ...changes,
    name: changes.name?.trim() || current.name || "待定",
    acronym: changes.acronym === undefined ? current.acronym : changes.acronym?.trim() || null,
    logo: changes.logo || current.logo || "/team-placeholder.svg",
  };
}

function matchKey(provider: MatchProvider, providerMatchId: string): string {
  return `${provider}:${providerMatchId}`;
}

export function applyManualOverrides(
  matches: EsportsMatch[],
  values: unknown[],
  now = new Date(),
): { matches: EsportsMatch[]; overrideCount: number; hiddenCount: number } {
  const updatedAt = now.toISOString();
  const overrides = values
    .filter(isManualOverride)
    .filter((override) => override.reviewStatus === "approved");
  const indexed = new Map<string, EsportsMatch>();
  for (const match of uniqueAndSort(matches)) {
    indexed.set(matchKey(match.provider, match.providerMatchId), match);
  }

  let hiddenCount = 0;
  for (const override of overrides) {
    const key = matchKey(override.provider, override.providerMatchId);
    const current = indexed.get(key);
    if (!current) continue;
    if (override.hidden) {
      indexed.delete(key);
      hiddenCount += 1;
      continue;
    }
    const changes = override.changes ?? {};
    indexed.set(key, {
      ...current,
      tournament: changes.tournament === undefined ? current.tournament : changes.tournament?.trim() || null,
      league: changes.league?.trim() || current.league,
      stage: changes.stage === undefined ? current.stage : changes.stage?.trim() || null,
      homeTeam: applyTeamChanges(current.homeTeam, changes.homeTeam),
      awayTeam: applyTeamChanges(current.awayTeam, changes.awayTeam),
      homeScore: changes.homeScore === undefined ? current.homeScore : changes.homeScore,
      awayScore: changes.awayScore === undefined ? current.awayScore : changes.awayScore,
      bestOf: changes.bestOf === undefined ? current.bestOf : changes.bestOf,
      status: changes.status
        ? normalizeStoredMatchStatus(changes.status) ?? current.status
        : current.status,
      startTimeUtc: changes.startTimeUtc === undefined
        ? current.startTimeUtc
        : changes.startTimeUtc
          ? new Date(changes.startTimeUtc).toISOString()
          : null,
      streams: changes.streams === undefined ? current.streams : safeStreams(changes.streams),
      sourceUrl: changes.sourceUrl === undefined ? current.sourceUrl : changes.sourceUrl,
      lastUpdatedAt: updatedAt,
      manualOverride: true,
    });
  }

  return { matches: uniqueAndSort([...indexed.values()]), overrideCount: overrides.length, hiddenCount };
}

export function applyManualData(autoMatches: EsportsMatch[], now = new Date()): {
  matches: EsportsMatch[];
  honorOfKingsCount: number;
  supplementalCount: number;
  overrideCount: number;
  hiddenCount: number;
} {
  const updatedAt = now.toISOString();
  const honorOfKings = (honorOfKingsData as unknown[])
    .filter(isLegacyHonorOfKingsMatch)
    .map((match) => normalizeManualMatch({
      ...match,
      game: "honor-of-kings",
      reviewStatus: "approved",
    }, updatedAt));
  const supplemental = ((supplementalData as { matches?: unknown[] }).matches ?? [])
    .filter(isManualRecord)
    .filter((match) => match.reviewStatus === "approved")
    .map((match) => normalizeManualMatch(match, updatedAt));
  const applied = applyManualOverrides(
    [...autoMatches, ...honorOfKings, ...supplemental],
    (supplementalData as { overrides?: unknown[] }).overrides ?? [],
    now,
  );

  return {
    matches: applied.matches,
    honorOfKingsCount: honorOfKings.length,
    supplementalCount: supplemental.length,
    overrideCount: applied.overrideCount,
    hiddenCount: applied.hiddenCount,
  };
}

export function getManualMatches(now = new Date()) {
  return applyManualData([], now);
}
