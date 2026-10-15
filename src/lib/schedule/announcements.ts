export const SCHEDULE_RESULT_ANNOUNCEMENT_DELAY_MS = 300;

export function scheduleResultAnnouncement(count: number, filterContext = ""): string {
  const context = filterContext ? `当前筛选：${filterContext}。` : "";
  if (count <= 0) return `没有符合条件的比赛。${context}`;
  return `筛选结果：${count} 场比赛。${context}`;
}

export function scheduleResultAnnouncementUpdate(
  count: number,
  filterContext: string,
  announce: (count: number, filterContext: string) => void,
): () => void {
  const timer = setTimeout(() => announce(count, filterContext), SCHEDULE_RESULT_ANNOUNCEMENT_DELAY_MS);
  return () => clearTimeout(timer);
}
