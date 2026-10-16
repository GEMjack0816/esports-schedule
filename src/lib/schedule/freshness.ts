import type { GameSyncStatus } from "./types";

export const FRESH_FOR_MS = 15 * 60 * 1_000;
export const FAILED_AFTER_MS = 60 * 60 * 1_000;

export type GameFreshnessDetails = {
  status: GameSyncStatus;
  sourceFetchedAt: string | null;
  lastErrorAt: string | null;
};

/** Distinguish a failed refresh from an old snapshot that simply expired. */
export function gameSyncStatusLabel({ status, sourceFetchedAt, lastErrorAt }: GameFreshnessDetails): string {
  if (status === "normal") return "正常";
  if (status === "delayed") return "延迟";

  const sourceTime = sourceFetchedAt ? Date.parse(sourceFetchedAt) : Number.NaN;
  const errorTime = lastErrorAt ? Date.parse(lastErrorAt) : Number.NaN;
  if (Number.isFinite(errorTime) && (!Number.isFinite(sourceTime) || errorTime >= sourceTime)) {
    return "同步失败";
  }
  return Number.isFinite(sourceTime) ? "数据已过期" : "暂无快照";
}

/** Aggregate game-level freshness without calling every stale state a partial delay. */
export function scheduleSourceLabel(
  mode: "live" | "unavailable",
  games: GameFreshnessDetails[],
  stale: boolean,
): string {
  if (mode === "unavailable") return "PandaScore 聚合数据（服务暂不可用）";
  if (games.length === 0) return "PandaScore 数据状态未知";

  const labels = games.map(gameSyncStatusLabel);
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);

  const delayed = counts.get("延迟") ?? 0;
  const failed = counts.get("同步失败") ?? 0;
  const expired = counts.get("数据已过期") ?? 0;
  const missing = counts.get("暂无快照") ?? 0;
  const abnormal = failed + expired + missing;
  const allHaveSnapshots = games.every((game) => {
    const fetchedAt = game.sourceFetchedAt ? Date.parse(game.sourceFetchedAt) : Number.NaN;
    return Number.isFinite(fetchedAt);
  });

  if (abnormal === 0 && delayed === 0) {
    return stale ? "PandaScore 数据可能延迟" : "PandaScore 聚合数据";
  }
  if (abnormal === 0) return `PandaScore 数据延迟（${delayed}/${games.length} 个游戏）`;
  if (failed === 0 && missing === 0 && expired === games.length) {
    return "PandaScore 数据已过期（仍展示上次成功快照）";
  }
  if (expired === 0 && missing === 0 && failed === games.length && allHaveSnapshots) {
    return "PandaScore 同步失败（仍展示上次成功快照）";
  }

  const parts = [
    failed > 0 ? `${failed} 个同步失败` : "",
    expired > 0 ? `${expired} 个数据已过期` : "",
    missing > 0 ? `${missing} 个暂无快照` : "",
    delayed > 0 ? `${delayed} 个数据延迟` : "",
  ].filter(Boolean);
  return `PandaScore 数据异常（${parts.join("，")}）`;
}

/** Keep the server payload and the long-lived browser tab on the same thresholds. */
export function gameSyncStatusAt(
  sourceFetchedAt: string | null,
  lastErrorAt: string | null,
  now: number,
): GameSyncStatus {
  const sourceTime = sourceFetchedAt ? Date.parse(sourceFetchedAt) : Number.NaN;
  const errorTime = lastErrorAt ? Date.parse(lastErrorAt) : Number.NaN;
  const snapshotAge = Number.isFinite(sourceTime)
    ? Math.max(0, now - sourceTime)
    : null;
  const failedAttempt = Number.isFinite(errorTime)
    && (snapshotAge === null || errorTime >= sourceTime);

  if (failedAttempt || snapshotAge === null || snapshotAge > FAILED_AFTER_MS) return "failed";
  if (snapshotAge > FRESH_FOR_MS) return "delayed";
  return "normal";
}

