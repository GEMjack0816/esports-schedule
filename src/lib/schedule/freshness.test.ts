import { describe, expect, it } from "vitest";
import {
  FAILED_AFTER_MS,
  FRESH_FOR_MS,
  gameSyncStatusAt,
  gameSyncStatusLabel,
  scheduleSourceLabel,
} from "./freshness";

const fetchedAt = "2026-10-13T00:00:00.000Z";
const fetchedMs = Date.parse(fetchedAt);

describe("gameSyncStatusAt", () => {
  it("keeps a snapshot normal through the 15-minute freshness boundary", () => {
    expect(gameSyncStatusAt(fetchedAt, null, fetchedMs + FRESH_FOR_MS)).toBe("normal");
    expect(gameSyncStatusAt(fetchedAt, null, fetchedMs + FRESH_FOR_MS + 1)).toBe("delayed");
  });

  it("marks a snapshot failed only after the 60-minute limit", () => {
    expect(gameSyncStatusAt(fetchedAt, null, fetchedMs + FAILED_AFTER_MS)).toBe("delayed");
    expect(gameSyncStatusAt(fetchedAt, null, fetchedMs + FAILED_AFTER_MS + 1)).toBe("failed");
  });

  it("does not let an error before the snapshot make it stale", () => {
    expect(gameSyncStatusAt(fetchedAt, "2026-10-12T23:59:59.000Z", fetchedMs + 1)).toBe("normal");
  });

  it("fails closed when an error is at or after the last successful snapshot", () => {
    expect(gameSyncStatusAt(fetchedAt, fetchedAt, fetchedMs + 1)).toBe("failed");
    expect(gameSyncStatusAt(fetchedAt, "2026-10-13T00:00:01.000Z", fetchedMs + 1)).toBe("failed");
  });

  it("treats missing or malformed snapshot times as failed", () => {
    expect(gameSyncStatusAt(null, null, fetchedMs)).toBe("failed");
    expect(gameSyncStatusAt("invalid", null, fetchedMs)).toBe("failed");
  });

  it("clamps clock skew instead of marking a future snapshot stale", () => {
    expect(gameSyncStatusAt("2026-10-13T00:01:00.000Z", null, fetchedMs)).toBe("normal");
  });
});

describe("freshness labels", () => {
  it("distinguishes an aged snapshot from an actual failed refresh", () => {
    expect(gameSyncStatusLabel({ status: "failed", sourceFetchedAt: fetchedAt, lastErrorAt: null }))
      .toBe("数据已过期");
    expect(gameSyncStatusLabel({ status: "failed", sourceFetchedAt: fetchedAt, lastErrorAt: fetchedAt }))
      .toBe("同步失败");
    expect(gameSyncStatusLabel({ status: "failed", sourceFetchedAt: null, lastErrorAt: null }))
      .toBe("暂无快照");
  });

  it("does not describe five expired game snapshots as a partial delay", () => {
    const expired = Array.from({ length: 5 }, () => ({
      status: "failed" as const,
      sourceFetchedAt: fetchedAt,
      lastErrorAt: null,
    }));
    expect(scheduleSourceLabel("live", expired, true))
      .toBe("PandaScore 数据已过期（仍展示上次成功快照）");
  });

  it("reports failed refreshes, delayed games, and missing snapshots distinctly", () => {
    const mixed = [
      { status: "failed" as const, sourceFetchedAt: fetchedAt, lastErrorAt: fetchedAt },
      { status: "delayed" as const, sourceFetchedAt: fetchedAt, lastErrorAt: null },
      { status: "failed" as const, sourceFetchedAt: null, lastErrorAt: null },
    ];
    expect(scheduleSourceLabel("live", mixed, true))
      .toBe("PandaScore 数据异常（1 个同步失败，1 个暂无快照，1 个数据延迟）");
    expect(scheduleSourceLabel("unavailable", mixed, true))
      .toBe("PandaScore 聚合数据（服务暂不可用）");
  });
});
