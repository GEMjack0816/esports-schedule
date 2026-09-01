import { refreshScheduleDetailed } from "@/lib/schedule";
import type { ScheduleSyncSummary } from "@/lib/schedule";
import type { SchedulePayload } from "@/lib/schedule/types";

export type CronSyncResponse = {
  ok: boolean;
  status: ScheduleSyncSummary["status"];
  lockAcquired: boolean;
  generation: number | null;
  gamesAttempted: number;
  gamesSucceeded: number;
  gamesFailed: number;
  snapshotsPersisted: number;
  errors: ScheduleSyncSummary["errors"];
  refreshedAt: string;
  matches: number;
  mode: SchedulePayload["mode"];
  stale: boolean;
  lastSuccessfulSyncAt: string | null;
  sourceFetchedAt: string | null;
  snapshotAgeSeconds: number | null;
  lastAttemptAt: string | null;
  refreshInProgress: boolean;
  lastError: SchedulePayload["coverage"]["lastError"];
  providers: SchedulePayload["providers"];
};

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { schedule, sync } = await refreshScheduleDetailed({ force: true });
  const responseStatus = sync.status === "busy"
    ? 409
    : sync.status === "failed" || sync.status === "not-configured"
      ? 503
      : 200;

  const body = {
    ok: sync.status === "success" || sync.status === "partial" || sync.status === "fresh",
    status: sync.status,
    lockAcquired: sync.lockAcquired,
    generation: sync.generation,
    gamesAttempted: sync.gamesAttempted,
    gamesSucceeded: sync.gamesSucceeded,
    gamesFailed: sync.gamesFailed,
    snapshotsPersisted: sync.snapshotsPersisted,
    errors: sync.errors,
    refreshedAt: schedule.generatedAt,
    matches: schedule.matches.length,
    mode: schedule.mode,
    stale: schedule.stale,
    lastSuccessfulSyncAt: schedule.lastSuccessfulSyncAt,
    sourceFetchedAt: schedule.coverage.sourceFetchedAt,
    snapshotAgeSeconds: schedule.coverage.snapshotAgeSeconds,
    lastAttemptAt: schedule.coverage.lastAttemptAt,
    refreshInProgress: schedule.coverage.refreshInProgress,
    lastError: schedule.coverage.lastError,
    providers: schedule.providers,
  } satisfies CronSyncResponse;

  return Response.json(body, { status: responseStatus });
}
