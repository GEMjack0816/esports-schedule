import { FRESH_FOR_MS, getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Vercel-CDN-Cache-Control": "no-store",
  Expires: "0",
  Pragma: "no-cache",
};

type FreshnessState = "fresh" | "stale" | "unavailable";
const MAX_FUTURE_TIMESTAMP_SKEW_MS = 60_000;

function isTimestamp(value: string | null, nowMs: number): boolean {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && timestamp <= nowMs + MAX_FUTURE_TIMESTAMP_SKEW_MS;
}

function responseBody(
  state: FreshnessState,
  schedule?: Awaited<ReturnType<typeof getSchedule>>,
) {
  return {
    service: "esports-schedule",
    status: state,
    mode: schedule?.mode ?? "unavailable",
    stale: schedule?.stale ?? true,
    snapshotAgeSeconds: schedule?.coverage.snapshotAgeSeconds ?? null,
    sourceFetchedAt: schedule?.coverage.sourceFetchedAt ?? null,
    lastSuccessfulSyncAt: schedule?.coverage.lastSuccessfulSyncAt ?? null,
    refreshInProgress: schedule?.coverage.refreshInProgress ?? false,
  };
}

export async function GET() {
  let schedule: Awaited<ReturnType<typeof getSchedule>>;
  try {
    schedule = await getSchedule({ cachedOnly: true });
  } catch {
    return Response.json(responseBody("unavailable"), {
      status: 503,
      headers: CACHE_HEADERS,
    });
  }

  const nowMs = Date.now();
  const age = schedule.coverage.snapshotAgeSeconds;
  const healthy = schedule.mode === "live"
    && schedule.demoMode === false
    && schedule.stale === false
    && Number.isSafeInteger(age)
    && age !== null
    && age >= 0
    && age <= Math.floor(FRESH_FOR_MS / 1_000)
    && isTimestamp(schedule.coverage.sourceFetchedAt, nowMs)
    && isTimestamp(schedule.coverage.lastSuccessfulSyncAt, nowMs);
  const state: FreshnessState = schedule.mode !== "live"
    ? "unavailable"
    : healthy ? "fresh" : "stale";

  return Response.json(responseBody(state, schedule), {
    status: healthy ? 200 : 503,
    headers: CACHE_HEADERS,
  });
}
