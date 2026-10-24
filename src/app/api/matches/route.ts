import { after } from "next/server";
import { getSchedule, refreshSchedule, shouldRefreshSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const payload = await getSchedule({ cachedOnly: true });
  const snapshotOnly = new URL(request.url).searchParams.get("snapshotOnly") === "1";
  const refreshScheduled = !snapshotOnly && shouldRefreshSchedule(payload);
  if (refreshScheduled) {
    after(async () => {
      await refreshSchedule();
    });
  }

  return Response.json(payload, {
    headers: {
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "Vercel-CDN-Cache-Control": "no-store",
      "X-Schedule-Mode": payload.mode,
      "X-Schedule-Stale": String(payload.stale),
      "X-Schedule-Refresh-Scheduled": String(refreshScheduled),
    },
  });
}
