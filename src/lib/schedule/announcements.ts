export const SCHEDULE_RESULT_ANNOUNCEMENT_DELAY_MS = 300;

export function scheduleResultAnnouncement(count: number): string {
  if (count <= 0) return "没有符合条件的比赛。";
  return `筛选结果：${count} 场比赛。`;
}

export function scheduleResultAnnouncementUpdate(
  count: number | null,
  announce: (count: number | null) => void,
): () => void {
  // Clear asynchronously so identical counts from different filters are still announced.
  const clearTimer = setTimeout(() => announce(null), 0);
  const publishTimer = count === null
    ? null
    : setTimeout(() => announce(count), SCHEDULE_RESULT_ANNOUNCEMENT_DELAY_MS);
  return () => {
    clearTimeout(clearTimer);
    if (publishTimer !== null) clearTimeout(publishTimer);
  };
}
