import { gameKeys } from "./types";
import type { EsportsMatch, SchedulePayload } from "./types";

// This fetch reads the existing schedule endpoint; it never calls PandaScore.
export const SCHEDULE_REFRESH_TIMEOUT_MS = 15_000;
export const SCHEDULE_REFRESH_POLL_INTERVAL_MS = 3_000;
export const SCHEDULE_REFRESH_COMPLETION_TIMEOUT_MS = 30_000;
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

function isOptionalNullableGeneration(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
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
      && isNullableDate(coverage.sourceFetchedAt)
      && isOptionalNullableGeneration(coverage.syncGeneration);
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

type GameGenerationView = Partial<Record<
  (typeof gameKeys)[number],
  { syncGeneration?: number | null }
>>;

/** Reject unavailable fallbacks and live responses older than any rendered game's snapshot. */
export function canReplaceSchedulePayload(
  currentMode: SchedulePayload["mode"],
  refreshedMode: SchedulePayload["mode"],
  currentGames?: GameGenerationView,
  refreshedGames?: GameGenerationView,
): boolean {
  if (currentMode !== "live") return true;
  if (refreshedMode !== "live") return false;

  return gameKeys.every((game) => {
    const currentGeneration = currentGames?.[game]?.syncGeneration;
    if (typeof currentGeneration !== "number") return true;

    const refreshedGeneration = refreshedGames?.[game]?.syncGeneration;
    return typeof refreshedGeneration === "number" && refreshedGeneration >= currentGeneration;
  });
}

type ScheduleRefreshTiming = {
  pollIntervalMs?: number;
  completionTimeoutMs?: number;
};

function hasNewerSnapshot(before: SchedulePayload, after: SchedulePayload): boolean {
  return gameKeys.some((game) => {
    const previous = before.coverage.games[game];
    const current = after.coverage.games[game];
    if (!current) return false;

    if (typeof previous?.syncGeneration === "number") {
      return typeof current.syncGeneration === "number"
        && current.syncGeneration > previous.syncGeneration;
    }
    if (previous?.sourceFetchedAt == null) return current.sourceFetchedAt !== null;
    return typeof previous?.sourceFetchedAt === "string"
      && typeof current.sourceFetchedAt === "string"
      && Date.parse(current.sourceFetchedAt) > Date.parse(previous.sourceFetchedAt);
  });
}

async function requestSchedulePayload(
  path: string,
  fetcher: typeof fetch,
  timeoutMs = SCHEDULE_REFRESH_TIMEOUT_MS,
): Promise<{ payload: SchedulePayload; refreshScheduled: boolean } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(path, { cache: "no-store", signal: controller.signal });
    if (!response.ok || !hasJsonContentType(response)) return null;
    const value = await response.json() as unknown;
    if (!isClientSchedulePayload(value)) return null;
    return {
      payload: value,
      refreshScheduled: response.headers.get("x-schedule-refresh-scheduled") === "true",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForRefreshCompletion(
  baseline: SchedulePayload,
  fetcher: typeof fetch,
  timing: Required<ScheduleRefreshTiming>,
): Promise<SchedulePayload | null> {
  const deadline = Date.now() + timing.completionTimeoutMs;
  const baselineAttempt = baseline.coverage.lastAttemptAt;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const snapshot = await requestSchedulePayload(
      "/api/matches?snapshotOnly=1",
      fetcher,
      Math.min(SCHEDULE_REFRESH_TIMEOUT_MS, remaining),
    );
    if (snapshot) {
      const payload = snapshot.payload;
      if (hasNewerSnapshot(baseline, payload)
        && canReplaceSchedulePayload(
          baseline.mode,
          payload.mode,
          baseline.coverage.games,
          payload.coverage.games,
        )) return payload;

      const attemptChanged = payload.coverage.lastAttemptAt !== null
        && payload.coverage.lastAttemptAt !== baselineAttempt;
      if (attemptChanged && !payload.coverage.refreshInProgress) return null;
    }

    const afterProbeRemaining = deadline - Date.now();
    if (afterProbeRemaining <= 0) break;
    await new Promise<void>((resolve) => setTimeout(
      resolve,
      Math.min(timing.pollIntervalMs, afterProbeRemaining),
    ));
  }
  return null;
}

export async function requestScheduleRefresh(
  fetcher: typeof fetch = fetch,
  timing: ScheduleRefreshTiming = {},
  baseline?: SchedulePayload,
): Promise<
  { ok: true; payload: SchedulePayload } | { ok: false }
> {
  const response = await requestSchedulePayload("/api/matches", fetcher);
  if (!response) return { ok: false };
  if (!response.refreshScheduled && !response.payload.coverage.refreshInProgress) {
    return { ok: true, payload: response.payload };
  }

  const renderedBaseline = baseline ?? response.payload;
  if (hasNewerSnapshot(renderedBaseline, response.payload)
    && canReplaceSchedulePayload(
      renderedBaseline.mode,
      response.payload.mode,
      renderedBaseline.coverage.games,
      response.payload.coverage.games,
    )) return { ok: true, payload: response.payload };

  const refreshed = await waitForRefreshCompletion(renderedBaseline, fetcher, {
    pollIntervalMs: timing.pollIntervalMs ?? SCHEDULE_REFRESH_POLL_INTERVAL_MS,
    completionTimeoutMs: timing.completionTimeoutMs ?? SCHEDULE_REFRESH_COMPLETION_TIMEOUT_MS,
  });
  return refreshed ? { ok: true, payload: refreshed } : { ok: false };
}
