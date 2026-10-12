import { scheduleResultAnnouncement } from "@/lib/schedule/announcements";

export function ScheduleResultStatus({ count }: { count: number }) {
  return (
    <p className="sr-only schedule-result-status" role="status" aria-live="polite" aria-atomic="true">
      {scheduleResultAnnouncement(count)}
    </p>
  );
}
