import { gameKeys } from "./types";
import type { EsportsMatch, SchedulePayload } from "./types";

// This fetch reads the existing schedule endpoint; it never calls PandaScore.
export const SCHEDULE_REFRESH_TIMEOUT_MS = 15_000;
export const SCHEDULE_REFRESH_ERROR = "刷新失败，已保留当前赛程。请稍后重试。";

const matchStatuses = new Set([
  "scheduled", "running", "finished", "postponed", "cancelled", "forfeit", "unknown",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function hasJsonContentType(response: Response): boolean {
  const mediaType = response.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  return mediaType === "application/json";
}

function isTeam(value: unknown): boolean {
  return isRecord(value)
    && typeof value.name === "string"
    && typeof value.logo === "string"
    && (value.acronym === undefined || isNullableString(value.acronym));
}

function isStream(value: unknown): boolean {
  if (!isRecord(value) || typeof value.label !== "string" || typeof value.url !== "string") return false;
  if (value.official !== undefined && typeof value.official !== "boolean") return false;
  try {
    return new URL(value.url).protocol === "https:";
  } catch {
    return false;
  }
}

function isMatch(value: unknown): value is EsportsMatch {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.provider === "pandascore" || value.provider === "manual")
    && typeof value.providerMatchId === "string"
    && gameKeys.some((game) => game === value.game)
    && isNullableString(value.tournament)
    && typeof value.league === "string"
    && isNullableString(value.stage)
    && isTeam(value.homeTeam)
    && isTeam(value.awayTeam)
    && isNullableNumber(value.homeScore)
    && isNullableNumber(value.awayScore)
    && isNullableNumber(value.bestOf)
    && typeof value.status === "string"
    && matchStatuses.has(value.status)
    && isNullableDate(value.startTimeUtc)
    && Array.isArray(value.streams)
    && value.streams.every(isStream)
    && typeof value.lastUpdatedAt === "string"
    && !Number.isNaN(Date.parse(value.lastUpdatedAt));
}

function hasRenderSafeCoverage(value: unknown): boolean {
  if (!isRecord(value)
    || !isNullableDate(value.sourceFetchedAt)
    || !isNullableDate(value.lastAttemptAt)
    || typeof value.refreshInProgress !== "boolean"
    || !isRecord(value.range)
    || !isNullableDate(value.range.earliestMatchAt)
    || !isNullableDate(value.range.latestMatchAt)
    || !isRecord(value.games)) return false;

  const games = value.games;
  return gameKeys.every((game) => {
    const coverage = games[game];
    return isRecord(coverage)
      && (coverage.syncStatus === "normal" || coverage.syncStatus === "delayed" || coverage.syncStatus === "failed")
      && typeof coverage.refreshInProgress === "boolean"
      && isNullableDate(coverage.sourceFetchedAt);
  });
}

function isClientSchedulePayload(value: unknown): value is SchedulePayload {
  return isRecord(value)
    && Array.isArray(value.matches)
    && value.matches.every(isMatch)
    && typeof value.generatedAt === "string"
    && !Number.isNaN(Date.parse(value.generatedAt))
    && (value.mode === "live" || value.mode === "unavailable")
    && typeof value.demoMode === "boolean"
    && typeof value.stale === "boolean"
    && isNullableDate(value.lastSuccessfulSyncAt)
    && isRecord(value.providers)
    && ["connected", "stale-cache", "not-configured", "error"].includes(String(value.providers.pandascore))
    && value.providers.manual === "json+database"
    && hasRenderSafeCoverage(value.coverage)
    && isRecord(value.deployment)
    && isNullableString(value.deployment.id)
    && isNullableString(value.deployment.commitSha)
    && isNullableString(value.deployment.productionUrl)
    && isNullableString(value.deployment.environment)
    && (value.warning === undefined || typeof value.warning === "string");
}

/** Do not replace a usable live schedule with an unavailable fallback. */
export function canReplaceSchedulePayload(
  currentMode: SchedulePayload["mode"],
  refreshedMode: SchedulePayload["mode"],
): boolean {
  return currentMode !== "live" || refreshedMode !== "unavailable";
}

export async function requestScheduleRefresh(fetcher: typeof fetch = fetch): Promise<
  { ok: true; payload: SchedulePayload } | { ok: false }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCHEDULE_REFRESH_TIMEOUT_MS);
  try {
    const response = await fetcher("/api/matches", { cache: "no-store", signal: controller.signal });
    if (!response.ok || !hasJsonContentType(response)) return { ok: false };
    const payload = await response.json() as unknown;
    if (!isClientSchedulePayload(payload)) return { ok: false };
    return { ok: true, payload };
  } catch {
    // Never display transport errors or response bodies, which can contain
    // infrastructure details. The caller retains its last rendered payload.
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
