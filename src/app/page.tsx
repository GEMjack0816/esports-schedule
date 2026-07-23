import { ScheduleDashboard } from "@/components/schedule-dashboard";
import { after } from "next/server";
import { getSchedule, refreshSchedule, shouldRefreshSchedule } from "@/lib/schedule";
import { getPublicVersionSummary } from "@/lib/version";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function Home() {
  const schedule = await getSchedule({ cachedOnly: true });
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
      <ScheduleDashboard initialData={schedule} />
    </>
  );
}
