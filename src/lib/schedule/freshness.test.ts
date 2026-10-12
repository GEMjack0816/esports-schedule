import { describe, expect, it } from "vitest";
import { FAILED_AFTER_MS, FRESH_FOR_MS, gameSyncStatusAt } from "./freshness";

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
