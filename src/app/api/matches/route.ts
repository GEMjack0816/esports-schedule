import { getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const payload = await getSchedule();

  return Response.json(payload, {
    headers: {
      "Cache-Control": payload.stale
        ? "public, s-maxage=60, stale-while-revalidate=300"
        : "public, s-maxage=300, stale-while-revalidate=900",
    },
  });
}
