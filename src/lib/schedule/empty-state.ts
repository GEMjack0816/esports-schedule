import type { SchedulePayload } from "./types";

export function getScheduleEmptyState(mode: SchedulePayload["mode"], totalMatchCount: number) {
  if (mode === "unavailable" && totalMatchCount === 0) {
    return {
      kind: "unavailable" as const,
      title: "赛程数据暂不可用",
      description: "当前没有可用的真实赛程快照。请稍后重试。",
    };
  }

  return {
    kind: "filters" as const,
    title: "没有找到符合条件的比赛",
    description: "试试切换时间范围，或清除部分筛选条件。",
  };
}
