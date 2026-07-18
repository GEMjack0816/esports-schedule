import { getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const schedule = await getSchedule({ forceRefresh: true });

  return Response.json({
    ok: true,
    refreshedAt: schedule.generatedAt,
    matches: schedule.matches.length,
    mode: schedule.mode,
    stale: schedule.stale,
    lastSuccessfulSyncAt: schedule.lastSuccessfulSyncAt,
    providers: schedule.providers,
  });
}
