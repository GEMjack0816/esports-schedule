export function scheduleResultAnnouncement(count: number): string {
  if (count <= 0) return "没有符合条件的比赛。";
  return `筛选结果：${count} 场比赛。`;
}
