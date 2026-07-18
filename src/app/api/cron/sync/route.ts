import { refreshSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const schedule = await refreshSchedule({ force: true });

  return Response.json({
    ok: true,
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
  });
}
