import { describe, expect, it } from "vitest";
import { getScheduleSourceLabel } from "./presentation";

const fiveDelayed = ["delayed", "delayed", "delayed", "delayed", "delayed"] as const;

describe("getScheduleSourceLabel", () => {
  it("uses the normal label for a fresh live snapshot", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: false,
      refreshInProgress: false,
      gameStatuses: ["normal"],
    })).toBe("PandaScore 聚合数据");
  });

  it("does not call all five delayed games only partially delayed", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: false,
      gameStatuses: fiveDelayed,
    })).toBe("PandaScore 聚合数据（更新延迟，当前显示上次成功快照）");
  });

  it("distinguishes a refresh in progress from a failed refresh", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: true,
      gameStatuses: fiveDelayed,
    })).toBe("PandaScore 聚合数据（正在更新，当前显示上次成功快照）");
  });

  it("reports partial game failures accurately", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: false,
      gameStatuses: ["normal", "failed", "delayed", "normal", "failed"],
    })).toBe("PandaScore 聚合数据（部分同步失败，当前显示上次成功快照）");
  });

  it("reports when every game sync failed", () => {
    expect(getScheduleSourceLabel({
      mode: "live",
      stale: true,
      refreshInProgress: false,
      gameStatuses: ["failed", "failed", "failed", "failed", "failed"],
    })).toBe("PandaScore 聚合数据（同步失败，当前显示上次成功快照）");
  });

  it("preserves the unavailable label when no usable snapshot exists", () => {
    expect(getScheduleSourceLabel({
      mode: "unavailable",
      stale: true,
      refreshInProgress: false,
      gameStatuses: fiveDelayed,
    })).toBe("PandaScore 聚合数据（服务暂不可用）");
  });
});
