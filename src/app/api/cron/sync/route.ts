import { refreshScheduleDetailed } from "@/lib/schedule";

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

  return Response.json({
    ok: sync.status === "success" || sync.status === "partial" || sync.status === "fresh",
    status: sync.status,
    lockAcquired: sync.lockAcquired,
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
  }, { status: responseStatus });
}
