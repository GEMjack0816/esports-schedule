import { describe, expect, it } from "vitest";
import { getScheduleEmptyState } from "./empty-state";

describe("getScheduleEmptyState", () => {
  it("explains an unavailable first snapshot instead of suggesting filter changes", () => {
    expect(getScheduleEmptyState("unavailable", 0)).toEqual({
      kind: "unavailable",
      title: "赛程数据暂不可用",
      description: "当前没有可用的真实赛程快照。请稍后重试。",
    });
  });

  it("keeps filter guidance when usable matches exist but current filters hide them", () => {
    expect(getScheduleEmptyState("unavailable", 2)).toEqual({
      kind: "filters",
      title: "没有找到符合条件的比赛",
      description: "试试切换时间范围，或清除部分筛选条件。",
    });
  });

  it("does not label a live empty range as a source outage", () => {
    expect(getScheduleEmptyState("live", 0).kind).toBe("filters");
  });
});
