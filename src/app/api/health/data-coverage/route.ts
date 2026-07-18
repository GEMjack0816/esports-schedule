import { getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const schedule = await getSchedule({ cachedOnly: true });

  return Response.json({
    demoMode: schedule.demoMode,
    providers: schedule.providers,
    ...schedule.coverage,
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
