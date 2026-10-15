import { getSchedule } from "@/lib/schedule";
import { getPublicVersionSummary } from "@/lib/version";
import { getDatabaseHealth } from "@/lib/review/public-matches";
import { getPreviewDatabaseTargetFingerprint } from "@/db/identity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const [schedule, database] = await Promise.all([
    getSchedule({ cachedOnly: true }),
    getDatabaseHealth(),
  ]);
  const databaseHealth = process.env.VERCEL_ENV === "preview"
    ? { ...database, targetFingerprint: getPreviewDatabaseTargetFingerprint() }
    : database;

  return Response.json({
    demoMode: schedule.demoMode,
    providers: schedule.providers,
    deployment: schedule.deployment,
    version: getPublicVersionSummary(),
    database: databaseHealth,
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
