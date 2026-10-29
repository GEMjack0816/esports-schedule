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
  if (refreshInProgress) {
    return syncStatus === "failed"
      ? { label: "重试中（上次失败）", visualStatus: "failed" }
      : { label: "同步中", visualStatus: "delayed" };
  }
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
  snapshotAgeSeconds?: number | null;
  gameStates: readonly Pick<GameCoverage, "syncStatus" | "lastError">[];
};

export type ScheduleSourceVisualStatus = "live" | "stale" | "critical" | "unavailable";

const STALE_AFTER_SECONDS = 15 * 60;
const CRITICAL_AFTER_SECONDS = 60 * 60;

function validSnapshotAge(seconds: number | null | undefined): number | null {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
    ? seconds
    : null;
}

export function getScheduleSourceVisualStatus(input: Pick<ScheduleSourceLabelInput, "mode" | "stale" | "snapshotAgeSeconds">): ScheduleSourceVisualStatus {
  if (input.mode === "unavailable") return "unavailable";

  const age = validSnapshotAge(input.snapshotAgeSeconds);
  if (age !== null && age > CRITICAL_AFTER_SECONDS) return "critical";
  if (input.stale || (age !== null && age > STALE_AFTER_SECONDS)) return "stale";
  return "live";
}

export function getScheduleSourceLabel({
  mode,
  stale,
  refreshInProgress,
  snapshotAgeSeconds,
  gameStates,
}: ScheduleSourceLabelInput): string {
  if (mode === "unavailable") return "PandaScore 聚合数据（服务暂不可用）";
  const age = validSnapshotAge(snapshotAgeSeconds);
  const isStale = stale || (age !== null && age > STALE_AFTER_SECONDS);
  if (!isStale) return "PandaScore 聚合数据";

  const failedGames = gameStates.filter((game) => game.syncStatus === "failed").length;
  const unavailableGames = gameStates.filter((game) => game.syncStatus === "unavailable").length;
  let label: string;
  if (refreshInProgress) {
    if (failedGames === gameStates.length && failedGames > 0) {
      label = "PandaScore 聚合数据（全部游戏上次同步失败，正在重试；当前显示上次成功快照）";
    } else if (failedGames > 0) {
      label = "PandaScore 聚合数据（部分游戏上次同步失败，正在更新；当前显示上次成功快照）";
    } else {
      label = "PandaScore 聚合数据（正在更新，当前显示上次成功快照）";
    }
  } else if (failedGames === gameStates.length && failedGames > 0) {
    label = "PandaScore 聚合数据（同步失败，当前显示上次成功快照）";
  } else if (failedGames > 0) {
    label = "PandaScore 聚合数据（部分同步失败，当前显示上次成功快照）";
  } else if (unavailableGames > 0) {
    label = "PandaScore 聚合数据（部分游戏暂无快照）";
  } else {
    label = "PandaScore 聚合数据（赛程快照已过期，当前显示已缓存数据）";
  }

  return age !== null && age > CRITICAL_AFTER_SECONDS
    ? `${label.slice(0, -1)}；数据已超过 1 小时未更新）`
    : label;
}
