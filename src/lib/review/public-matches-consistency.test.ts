import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  cached: vi.fn(),
  revision: vi.fn(),
  snapshot: vi.fn(),
  delivered: vi.fn(),
  failed: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({ getCache: () => ({ get: mocks.get, set: mocks.set }) }));
vi.mock("next/cache", () => ({ unstable_cache: () => mocks.cached }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("./repository", () => ({ getReviewRepository: () => ({
  getCurrentManualMatchRevision: mocks.revision,
  readManualMatchCacheSnapshot: mocks.snapshot,
  markManualMatchCacheDelivered: mocks.delivered,
  markManualMatchCacheDeliveryFailed: mocks.failed,
}) }));

import { getPublishedDatabaseMatches, writeManualMatchCacheFence } from "./public-matches";

describe("manual match cache authoritative version checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cached.mockResolvedValue({ matches: [], fetchedAt: new Date().toISOString(), revision: 4 });
    mocks.revision.mockResolvedValue(5);
    mocks.snapshot.mockResolvedValue({ rows: [], revision: 5, pendingRevisions: 1 });
    mocks.get.mockResolvedValue({ revision: 4 });
    mocks.set.mockResolvedValue(undefined);
    mocks.delivered.mockResolvedValue(undefined);
    mocks.failed.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => { vi.useRealTimers(); });

  it("does not let a matching old regional cache and fence hide a newer committed revision", async () => {
    const result = await getPublishedDatabaseMatches();
    expect(result.state.cacheRevision).toBe(5);
    expect(mocks.snapshot).toHaveBeenCalledOnce();
  });

  it("returns current database results even when repairing the stale cache fails", async () => {
    mocks.set.mockRejectedValue(new Error("cache unavailable"));
    const result = await getPublishedDatabaseMatches();
    expect(result.state.cacheRevision).toBe(5);
    expect(result.state.status).toBe("connected");
    expect(mocks.failed).toHaveBeenCalledWith(5);
  });

  it("reuses the payload when its revision matches PostgreSQL", async () => {
    mocks.revision.mockResolvedValue(4);
    const result = await getPublishedDatabaseMatches();
    expect(result.state.cacheRevision).toBe(4);
    expect(mocks.revision).toHaveBeenCalledOnce();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("rejects old fallback after learning a newer revision even if the subsequent full read fails", async () => {
    mocks.snapshot.mockRejectedValue(new Error("database unavailable"));
    mocks.get.mockImplementation(async (key: string) => key.includes("fence")
      ? { revision: 4 }
      : { matches: [], fetchedAt: new Date().toISOString(), revision: 4 });
    const result = await getPublishedDatabaseMatches();
    expect(result.state.status).toBe("unavailable");
    expect(result.matches).toEqual([]);
  });

  it("retains fallback if it satisfies the revision already observed from PostgreSQL", async () => {
    mocks.snapshot.mockRejectedValue(new Error("database unavailable"));
    mocks.get.mockImplementation(async (key: string) => key.includes("fence")
      ? { revision: 4 }
      : { matches: [], fetchedAt: new Date().toISOString(), revision: 5 });
    const result = await getPublishedDatabaseMatches();
    expect(result.state.status).toBe("cached");
    expect(result.state.cacheRevision).toBe(5);
  });

  it("does not abandon a pending fence write that could complete out of order", async () => {
    vi.useFakeTimers();
    let fence = { revision: 3 };
    let finishOldWrite!: () => void;
    mocks.set.mockImplementationOnce((_key, value: { revision: number }) => new Promise<void>((resolve) => {
      finishOldWrite = () => { fence = value; resolve(); };
    })).mockImplementation((_key, value: { revision: number }) => {
      fence = value;
      return Promise.resolve();
    });
    mocks.get.mockImplementation(async () => fence);
    let settled = false;
    const pending = writeManualMatchCacheFence(4).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(settled).toBe(false);
    expect(fence.revision).toBe(3);
    finishOldWrite();
    await pending;
    expect(fence.revision).toBe(4);
    await writeManualMatchCacheFence(5);
    expect(fence.revision).toBe(5);
    const result = await getPublishedDatabaseMatches();
    expect(result.state.cacheRevision).toBe(5);
    expect(vi.getTimerCount()).toBe(0);
  });
});

