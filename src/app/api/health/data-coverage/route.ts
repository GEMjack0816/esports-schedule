import { getSchedule } from "@/lib/schedule";
import { getPublicVersionSummary } from "@/lib/version";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const schedule = await getSchedule({ cachedOnly: true });

  return Response.json({
    demoMode: schedule.demoMode,
    providers: schedule.providers,
    deployment: schedule.deployment,
    version: getPublicVersionSummary(),
    ...schedule.coverage,
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Vercel-CDN-Cache-Control": "no-store",
      Expires: "0",
      Pragma: "no-cache",
    },
  });
}
