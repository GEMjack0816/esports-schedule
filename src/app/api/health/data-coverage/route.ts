import { getSchedule } from "@/lib/schedule";
import { getPublicVersionSummary } from "@/lib/version";
import { getDatabaseHealth } from "@/lib/review/public-matches";
import { getPreviewDatabaseTargetFingerprint } from "@/db/identity";
import { requireAdminApi } from "@/lib/auth/admin-page";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const [schedule, database] = await Promise.all([
    getSchedule({ cachedOnly: true }),
    getDatabaseHealth(),
  ]);
  let databaseHealth: typeof database | (typeof database & { targetFingerprint: string | null }) = database;
  if (process.env.VERCEL_ENV === "preview") {
    const admin = await requireAdminApi();
    if (admin.ok) {
      databaseHealth = { ...database, targetFingerprint: getPreviewDatabaseTargetFingerprint() };
    }
  }

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
