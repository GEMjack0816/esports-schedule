import { ScheduleDashboard } from "@/components/schedule-dashboard";
import { after } from "next/server";
import { getSchedule, refreshSchedule, shouldRefreshSchedule } from "@/lib/schedule";
import { getPublicVersionSummary } from "@/lib/version";
import { selectInitialScheduleWindow } from "@/lib/schedule/initial-window";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function Home() {
  const schedule = await getSchedule({ cachedOnly: true });
  const version = getPublicVersionSummary();
  const initialData = {
    ...schedule,
    matches: selectInitialScheduleWindow(schedule.matches),
  };
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
      <ScheduleDashboard
        initialData={initialData}
        availableLeagues={[...new Set(schedule.matches.map((match) => match.league))].sort()}
      />
    </>
  );
}
