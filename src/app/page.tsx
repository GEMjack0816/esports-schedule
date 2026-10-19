import { ScheduleDashboard } from "@/components/schedule-dashboard";
import { after } from "next/server";
import { getSchedule, refreshSchedule, shouldRefreshSchedule } from "@/lib/schedule";
import { getPublicVersionSummary } from "@/lib/version";
import { parseScheduleFilters } from "@/lib/schedule/filter-state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const schedule = await getSchedule({ cachedOnly: true });
  const rawSearchParams = await searchParams;
  const filterParams = new URLSearchParams();
  for (const [key, value] of Object.entries(rawSearchParams)) {
    if (typeof value === "string") filterParams.set(key, value);
    else if (Array.isArray(value) && typeof value[0] === "string") filterParams.set(key, value[0]);
  }
  const initialFilters = parseScheduleFilters(filterParams);
  const version = getPublicVersionSummary();
  if (shouldRefreshSchedule(schedule)) {
    after(async () => {
      await refreshSchedule();
    });
  }
  return (
    <>
      <span
        id="esports-schedule-version"
        data-git-commit={version.gitCommitSha ?? ""}
        data-deployment-id={version.deploymentId ?? ""}
        hidden
        aria-hidden="true"
      />
      <ScheduleDashboard initialData={schedule} initialFilters={initialFilters} />
    </>
  );
}
