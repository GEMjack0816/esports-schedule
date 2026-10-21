import { describe, expect, it } from "vitest";
import { getGameSyncPresentation, getScheduleSourceLabel } from "./presentation";

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

  it("shows an updating state before the previous status", () => {
    expect(getGameSyncPresentation({ syncStatus: "failed", lastError: error, refreshInProgress: true }))
      .toEqual({ label: "同步中", visualStatus: "delayed" });
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
});
