import { describe, expect, it } from "vitest";
import { getGameSyncPresentation, getScheduleSourceLabel, getScheduleSourceVisualStatus } from "./presentation";

const fiveDelayed = ["delayed", "delayed", "delayed", "delayed", "delayed"] as const;
const noErrorStates = fiveDelayed.map((syncStatus) => ({ syncStatus, lastError: null }));
const staleWithoutErrors = Array.from({ length: 5 }, () => ({ syncStatus: "stale" as const, lastError: null }));
const error = { at: "2026-10-21T12:35:00.000Z", code: "UPSTREAM", httpStatus: 502 };

describe("getGameSyncPresentation", () => {
  it("labels an age-expired status as an expired snapshot without error evidence", () => {
    expect(getGameSyncPresentation({ syncStatus: "stale", lastError: null, refreshInProgress: false }))
      .toEqual({ label: "快照过期", visualStatus: "delayed" });
  });

  it("does not call a missing snapshot a failed or expired sync", () => {
    expect(getGameSyncPresentation({ syncStatus: "unavailable", lastError: null, refreshInProgress: false }))
      .toEqual({ label: "暂无可用快照", visualStatus: "unknown" });
  });

  it("preserves a known failed status when error details are present", () => {
    expect(getGameSyncPresentation({ syncStatus: "failed", lastError: error, refreshInProgress: false }))
      .toEqual({ label: "同步失败", visualStatus: "failed" });
  });

  it("does not hide a known failed status when error details are unavailable", () => {
    expect(getGameSyncPresentation({ syncStatus: "failed", lastError: null, refreshInProgress: false }))
      .toEqual({ label: "同步失败", visualStatus: "failed" });
  });

  it("shows a retry state when a refresh is active after a failed sync", () => {
    expect(getGameSyncPresentation({ syncStatus: "failed", lastError: error, refreshInProgress: true }))
      .toEqual({ label: "重试中（上次失败）", visualStatus: "failed" });
  });

  it("avoids claiming failure when coverage is absent", () => {
    expect(getGameSyncPresentation({ syncStatus: null, lastError: null, refreshInProgress: false }))
      .toEqual({ label: "状态未知", visualStatus: "unknown" });
  });
});

describe("getScheduleSourceLabel", () => {
  it("uses the normal label for a fresh live snapshot", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: false,
      refreshInProgress: false,
      gameStates: [{ syncStatus: "normal", lastError: null }],
    })).toBe("PandaScore 聚合数据");
  });

  it("does not call age-expired snapshots a provider sync failure without error evidence", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: false,
      gameStates: staleWithoutErrors,
    })).toBe("PandaScore 聚合数据（赛程快照已过期，当前显示已缓存数据）");
  });

  it("labels delayed snapshots beyond the freshness window without inventing sync failures", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: false,
      gameStates: noErrorStates,
    })).toBe("PandaScore 聚合数据（赛程快照已过期，当前显示已缓存数据）");
  });

  it("distinguishes a refresh in progress from a failed refresh", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: true,
      gameStates: noErrorStates,
    })).toBe("PandaScore 聚合数据（正在更新，当前显示上次成功快照）");
  });

  it("keeps the prior all-games failure visible while a retry is active", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: true,
      gameStates: Array.from({ length: 5 }, () => ({ syncStatus: "failed" as const, lastError: error })),
    })).toBe("PandaScore 聚合数据（全部游戏上次同步失败，正在重试；当前显示上次成功快照）");
  });

  it("keeps partial failures visible while a retry is active", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: true,
      gameStates: [
        { syncStatus: "failed", lastError: error },
        { syncStatus: "normal", lastError: null },
        { syncStatus: "normal", lastError: null },
        { syncStatus: "normal", lastError: null },
        { syncStatus: "normal", lastError: null },
      ],
    })).toBe("PandaScore 聚合数据（部分游戏上次同步失败，正在更新；当前显示上次成功快照）");
  });

  it("reports partial game failures accurately", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: false,
      gameStates: [
        { syncStatus: "normal", lastError: null },
        { syncStatus: "failed", lastError: error },
        { syncStatus: "delayed", lastError: null },
        { syncStatus: "normal", lastError: null },
        { syncStatus: "failed", lastError: error },
      ],
    })).toBe("PandaScore 聚合数据（部分同步失败，当前显示上次成功快照）");
  });

  it("reports when every game sync failed", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: false,
      gameStates: Array.from({ length: 5 }, () => ({ syncStatus: "failed" as const, lastError: error })),
    })).toBe("PandaScore 聚合数据（同步失败，当前显示上次成功快照）");
  });

  it("reports failed syncs even when error details are unavailable", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: false,
      gameStates: Array.from({ length: 5 }, () => ({ syncStatus: "failed" as const, lastError: null })),
    })).toBe("PandaScore 聚合数据（同步失败，当前显示上次成功快照）");
  });

  it("preserves the unavailable label when no usable snapshot exists", () => {
    expect(getScheduleSourceLabel({
      mode: "unavailable",
      stale: true,
      refreshInProgress: false,
      gameStates: noErrorStates,
    })).toBe("PandaScore 聚合数据（服务暂不可用）");
  });

  it("adds explicit critical-age context when the snapshot is over one hour old", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: false,
      snapshotAgeSeconds: 3601,
      gameStates: staleWithoutErrors,
    })).toBe("PandaScore 聚合数据（赛程快照已过期，当前显示已缓存数据；数据已超过 1 小时未更新）");
  });
});

describe("getScheduleSourceVisualStatus", () => {
  const input = { mode: "live" as const, stale: false };

  it("keeps a snapshot live through the 15-minute boundary", () => {
    expect(getScheduleSourceVisualStatus({ ...input, snapshotAgeSeconds: 900 })).toBe("live");
  });

  it("marks data older than 15 minutes as delayed even if the stale flag disagrees", () => {
    expect(getScheduleSourceVisualStatus({ ...input, snapshotAgeSeconds: 901 })).toBe("stale");
  });

  it("uses the critical state only when age exceeds one hour", () => {
    expect(getScheduleSourceVisualStatus({ ...input, stale: true, snapshotAgeSeconds: 3600 })).toBe("stale");
    expect(getScheduleSourceVisualStatus({ ...input, stale: false, snapshotAgeSeconds: 3601 })).toBe("critical");
  });

  it("does not label stale snapshots as fresh when age metadata is missing", () => {
    expect(getScheduleSourceVisualStatus({ ...input, stale: true, snapshotAgeSeconds: null })).toBe("stale");
  });

  it("marks unavailable data as critical regardless of snapshot age", () => {
    expect(getScheduleSourceVisualStatus({ mode: "unavailable", stale: true, snapshotAgeSeconds: null }))
      .toBe("unavailable");
  });
});
