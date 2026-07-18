import { ScheduleDashboard } from "@/components/schedule-dashboard";
import { getSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function Home() {
  const schedule = await getSchedule();
  return <ScheduleDashboard initialData={schedule} />;
}
