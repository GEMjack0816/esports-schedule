import type { GameCoverage } from "./types";

export type GameSyncVisualStatus = "normal" | "delayed" | "failed" | "unknown";

export type GameSyncPresentation = {
  label: string;
  visualStatus: GameSyncVisualStatus;
};

export function getGameSyncPresentation(input: {
  syncStatus: GameCoverage["syncStatus"] | null | undefined;
  lastError: GameCoverage["lastError"] | null | undefined;
  refreshInProgress: boolean;
}): GameSyncPresentation {
  const { syncStatus, refreshInProgress } = input;
  if (refreshInProgress) return { label: "同步中", visualStatus: "delayed" };
  if (syncStatus === "normal") return { label: "正常", visualStatus: "normal" };
  if (syncStatus === "delayed") return { label: "延迟", visualStatus: "delayed" };
  if (syncStatus === "stale") return { label: "快照过期", visualStatus: "delayed" };
  // Status is authoritative even when the provider did not return a
  // diagnostic code. Missing details must not hide a known failed sync.
  if (syncStatus === "failed") return { label: "同步失败", visualStatus: "failed" };
  if (syncStatus === "unavailable") return { label: "暂无可用快照", visualStatus: "unknown" };
  return { label: "状态未知", visualStatus: "unknown" };
}

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

  const failedGames = gameStates.filter((game) => game.syncStatus === "failed").length;
  const unavailableGames = gameStates.filter((game) => game.syncStatus === "unavailable").length;
  if (failedGames === gameStates.length && failedGames > 0) {
    return "PandaScore 聚合数据（同步失败，当前显示上次成功快照）";
  }
  if (failedGames > 0) {
    return "PandaScore 聚合数据（部分同步失败，当前显示上次成功快照）";
  }
  if (unavailableGames > 0) {
    return "PandaScore 聚合数据（部分游戏暂无快照）";
  }

  return "PandaScore 聚合数据（赛程快照已过期，当前显示已缓存数据）";
}
