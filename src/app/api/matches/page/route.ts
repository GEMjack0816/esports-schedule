import { after } from "next/server";
import { getSchedule, refreshSchedule, shouldRefreshSchedule } from "@/lib/schedule";
import { createSchedulePage, parseSchedulePageQuery, SchedulePageQueryError } from "@/lib/schedule/server-page";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  let query;
  try {
    query = parseSchedulePageQuery(new URL(request.url).searchParams);
  } catch (error) {
    if (error instanceof SchedulePageQueryError) {
      return Response.json({ error: error.code }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "INVALID_QUERY" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const payload = await getSchedule({ cachedOnly: true });
  const refreshScheduled = shouldRefreshSchedule(payload);
  if (refreshScheduled) {
    after(async () => {
      await refreshSchedule();
    });
  }

  const page = createSchedulePage(payload, query);
  return Response.json(page, {
    headers: {
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "Vercel-CDN-Cache-Control": "no-store",
      "X-Schedule-Mode": payload.mode,
      "X-Schedule-Stale": String(payload.stale),
      "X-Schedule-Refresh-Scheduled": String(refreshScheduled),
    },
  });
}
