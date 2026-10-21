import type { GameCoverage } from "./types";

export type ScheduleSourceLabelInput = {
  mode: "live" | "unavailable";
  stale: boolean;
  refreshInProgress: boolean;
  gameStates: readonly Pick<GameCoverage, "syncStatus" | "lastError">[];
};

export function getScheduleSourceLabel({
  mode,
  stale,
  refreshInProgress,
  gameStates,
}: ScheduleSourceLabelInput): string {
  if (mode === "unavailable") return "PandaScore 聚合数据（服务暂不可用）";
  if (!stale) return "PandaScore 聚合数据";
  if (refreshInProgress) return "PandaScore 聚合数据（正在更新，当前显示上次成功快照）";

  const failedGames = gameStates.filter((game) => game.syncStatus === "failed" && game.lastError !== null).length;
  if (failedGames === gameStates.length && failedGames > 0) {
    return "PandaScore 聚合数据（同步失败，当前显示上次成功快照）";
  }
  if (failedGames > 0) {
    return "PandaScore 聚合数据（部分同步失败，当前显示上次成功快照）";
  }

  return "PandaScore 聚合数据（赛程快照已过期，当前显示已缓存数据）";
}
