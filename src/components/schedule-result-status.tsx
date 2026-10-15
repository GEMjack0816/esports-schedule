import { scheduleResultAnnouncement } from "@/lib/schedule/announcements";

export function ScheduleResultStatus({ count, filterContext = "" }: { count: number; filterContext?: string }) {
  return (
    <p className="sr-only schedule-result-status" role="status" aria-live="polite" aria-atomic="true">
      {scheduleResultAnnouncement(count, filterContext)}
    </p>
  );
}
