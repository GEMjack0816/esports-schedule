import { scheduleResultAnnouncement } from "@/lib/schedule/announcements";

export function ScheduleResultStatus({ count }: { count: number | null }) {
  return (
    <p className="sr-only schedule-result-status" role="status" aria-live="polite" aria-atomic="true">
      {count === null ? "" : scheduleResultAnnouncement(count)}
    </p>
  );
}
