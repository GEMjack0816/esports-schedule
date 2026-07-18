import { getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getSchedule();

  return Response.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
    },
  });
}
