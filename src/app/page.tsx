import { ScheduleDashboard } from "@/components/schedule-dashboard";
import { after } from "next/server";
import { getSchedule, refreshSchedule, shouldRefreshSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function Home() {
  const schedule = await getSchedule({ cachedOnly: true });
  if (shouldRefreshSchedule(schedule)) {
    after(async () => {
      await refreshSchedule();
    });
  }
  return <ScheduleDashboard initialData={schedule} />;
}
