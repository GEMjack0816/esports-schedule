import { getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const payload = await getSchedule();

  return Response.json(payload, {
    headers: {
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "Vercel-CDN-Cache-Control": "no-store",
      "X-Schedule-Mode": payload.mode,
      "X-Schedule-Stale": String(payload.stale),
    },
  });
}
