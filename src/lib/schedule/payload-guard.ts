import { gameKeys } from "./types";
import type {
  DataCoverage,
  EndpointCoverage,
  EsportsMatch,
  GameCoverage,
  MatchStatus,
  SchedulePayload,
  SyncErrorInfo,
} from "./types";

const matchStatuses = new Set<MatchStatus>([
  "scheduled",
  "running",
  "finished",
  "postponed",
  "cancelled",
  "forfeit",
  "unknown",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSyncError(value: unknown): value is SyncErrorInfo | null {
  return value === null || (isRecord(value)
    && typeof value.at === "string"
    && typeof value.code === "string"
    && isNullableNumber(value.httpStatus));
}

function isTeam(value: unknown): value is EsportsMatch["homeTeam"] {
  return isRecord(value)
    && typeof value.name === "string"
    && typeof value.logo === "string"
    && (value.acronym === undefined || isNullableString(value.acronym));
}

function isMatch(value: unknown): value is EsportsMatch {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.provider === "pandascore" || value.provider === "manual")
    && typeof value.providerMatchId === "string"
    && gameKeys.includes(value.game as (typeof gameKeys)[number])
    && typeof value.league === "string"
    && isNullableString(value.tournament)
    && isNullableString(value.stage)
    && isTeam(value.homeTeam)
    && isTeam(value.awayTeam)
    && isNullableNumber(value.homeScore)
    && isNullableNumber(value.awayScore)
    && isNullableNumber(value.bestOf)
    && typeof value.status === "string"
    && matchStatuses.has(value.status as MatchStatus)
    && isNullableString(value.startTimeUtc)
    && Array.isArray(value.streams)
    && value.streams.every((stream) => isRecord(stream)
      && typeof stream.label === "string"
      && typeof stream.url === "string"
      && (stream.official === undefined || typeof stream.official === "boolean"))
    && typeof value.lastUpdatedAt === "string"
    && (value.sourceUrl === undefined || isNullableString(value.sourceUrl))
    && (value.manualOverride === undefined || typeof value.manualOverride === "boolean");
}

function isNonNegativeNumberRecord(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.every((key) => isFiniteNumber(value[key]) && value[key] >= 0);
}

function isEndpointCoverage(value: unknown): value is EndpointCoverage {
  if (!isRecord(value)
    || !["pages", "xTotal", "raw", "normalized", "deduplicated", "final"].every((key) =>
      isFiniteNumber(value[key]) && value[key] >= 0)
    || !isRecord(value.filtered)) return false;

  const filtered = value.filtered;
  return ["missingId", "missingTime", "invalidTime", "outsideWindow", "duplicate"]
    .every((key) => isFiniteNumber(filtered[key]) && filtered[key] >= 0);
}

function isGameCoverage(value: unknown): value is GameCoverage {
  if (!isRecord(value)
    || !isRecord(value.endpoints)
    || !["upcoming", "running", "past"].every((key) => isEndpointCoverage((value.endpoints as Record<string, unknown>)[key]))
    || !["pages", "xTotal", "raw", "normalized", "deduplicated", "final"].every((key) =>
      isFiniteNumber(value[key]) && value[key] >= 0)
    || !isRecord(value.statusCounts)
    || !isNonNegativeNumberRecord(value.statusCounts, [...matchStatuses])
    || !isNullableString(value.earliestMatchAt)
    || !isNullableString(value.latestMatchAt)
    || !isNullableString(value.lastSuccessfulSyncAt)
    || !isNullableString(value.lastAttemptAt)
    || !isNullableString(value.sourceFetchedAt)
    || !isNullableNumber(value.snapshotAgeSeconds)
    || typeof value.refreshInProgress !== "boolean"
    || (value.syncStatus !== "normal" && value.syncStatus !== "delayed" && value.syncStatus !== "failed")
    || !isNullableNumber(value.staleMinutes)
    || (value.dataSource !== "fresh" && value.dataSource !== "cache" && value.dataSource !== "persistent" && value.dataSource !== "unavailable")
    || !isNullableString(value.lastErrorCode)
    || !isSyncError(value.lastError)) return false;

  if (value.verificationSample === undefined || value.verificationSample === null) return true;
  const sample = value.verificationSample;
  return isRecord(sample)
    && typeof sample.providerMatchId === "string"
    && (sample.endpoint === "upcoming" || sample.endpoint === "running" || sample.endpoint === "past")
    && typeof sample.providerTournament === "string"
    && isNullableString(sample.providerStartTimeUtc)
    && typeof sample.normalizedTournament === "string"
    && isNullableString(sample.normalizedStartTimeUtc);
}

function isDataCoverage(value: unknown): value is DataCoverage {
  if (!isRecord(value)
    || (value.mode !== "live" && value.mode !== "unavailable")
    || typeof value.stale !== "boolean"
    || !isNullableString(value.syncAttemptedAt)
    || !isNullableString(value.lastAttemptAt)
    || !isNullableString(value.lastSuccessfulSyncAt)
    || !isNullableString(value.sourceFetchedAt)
    || !isNullableNumber(value.snapshotAgeSeconds)
    || typeof value.refreshInProgress !== "boolean"
    || !isSyncError(value.lastError)
    || !isNullableNumber(value.rateLimitRemaining)
    || !isRecord(value.range)
    || value.range.pastDays !== 30
    || value.range.futureDays !== 60
    || !isNullableString(value.range.earliestMatchAt)
    || !isNullableString(value.range.latestMatchAt)
    || !isRecord(value.totals)
    || !isNonNegativeNumberRecord(value.totals, ["xTotal", "raw", "normalized", "deduplicated", "finalPandaScore", "finalWithManual", "filtered"])
    || !isRecord(value.games)
    || !isRecord(value.manual)) return false;

  const games = value.games;
  return gameKeys.every((game) => isGameCoverage(games[game]))
    && isNonNegativeNumberRecord(value.manual, ["honorOfKings", "supplemental", "overrides", "hidden", "published", "database"]);
}

/** Validate data from a runtime fetch before replacing the last rendered schedule. */
export function isSchedulePayload(value: unknown): value is SchedulePayload {
  if (!isRecord(value)
    || !Array.isArray(value.matches)
    || !value.matches.every(isMatch)
    || typeof value.generatedAt !== "string"
    || (value.mode !== "live" && value.mode !== "unavailable")
    || typeof value.demoMode !== "boolean"
    || typeof value.stale !== "boolean"
    || (value.lastSuccessfulSyncAt !== null && typeof value.lastSuccessfulSyncAt !== "string")
    || !isRecord(value.providers)
    || (value.providers.pandascore !== "connected"
      && value.providers.pandascore !== "stale-cache"
      && value.providers.pandascore !== "not-configured"
      && value.providers.pandascore !== "error")
    || value.providers.manual !== "json+database"
    || !isDataCoverage(value.coverage)
    || !isRecord(value.deployment)
    || !isNullableString(value.deployment.id)
    || !isNullableString(value.deployment.commitSha)
    || !isNullableString(value.deployment.productionUrl)
    || !isNullableString(value.deployment.environment)
    || (value.warning !== undefined && typeof value.warning !== "string")) return false;

  return value.coverage.mode === value.mode && value.coverage.stale === value.stale;
}
