import type { GameSyncStatus } from "./types";

export type ScheduleSourceLabelInput = {
  mode: "live" | "unavailable";
  stale: boolean;
  refreshInProgress: boolean;
  gameStatuses: readonly GameSyncStatus[];
};

export function getScheduleSourceLabel({
  mode,
  stale,
  refreshInProgress,
  gameStatuses,
}: ScheduleSourceLabelInput): string {
  if (mode === "unavailable") return "PandaScore 聚合数据（服务暂不可用）";
  if (!stale) return "PandaScore 聚合数据";
  if (refreshInProgress) return "PandaScore 聚合数据（正在更新，当前显示上次成功快照）";

  const failedGames = gameStatuses.filter((status) => status === "failed").length;
  if (failedGames === gameStatuses.length && failedGames > 0) {
    return "PandaScore 聚合数据（同步失败，当前显示上次成功快照）";
  }
  if (failedGames > 0) {
    return "PandaScore 聚合数据（部分同步失败，当前显示上次成功快照）";
  }

  return "PandaScore 聚合数据（更新延迟，当前显示上次成功快照）";
}
