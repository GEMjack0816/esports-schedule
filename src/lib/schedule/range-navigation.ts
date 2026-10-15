export const scheduleRangeTabs = [
  ["today", "今日"],
  ["tomorrow", "明日"],
  ["seven", "未来 7 天"],
  ["history", "历史比赛"],
  ["all", "全部收录"],
] as const;

export type RangeKey = (typeof scheduleRangeTabs)[number][0];

/** Horizontal, automatically activated tabs: arrows wrap; Home/End jump. */
export function rangeForNavigationKey(current: RangeKey, key: string): RangeKey | null {
  const index = scheduleRangeTabs.findIndex(([range]) => range === current);
  if (key === "Home") return scheduleRangeTabs[0][0];
  if (key === "End") return scheduleRangeTabs[scheduleRangeTabs.length - 1][0];
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const offset = key === "ArrowRight" ? 1 : -1;
  return scheduleRangeTabs[(index + offset + scheduleRangeTabs.length) % scheduleRangeTabs.length][0];
}
