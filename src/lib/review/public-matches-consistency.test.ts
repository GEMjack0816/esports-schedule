import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  cached: vi.fn(),
  cacheStatus: vi.fn(),
  snapshot: vi.fn(),
  delivered: vi.fn(),
  failed: vi.fn(),
  counts: vi.fn(),
  ping: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({ getCache: () => ({ get: mocks.get, set: mocks.set }) }));
vi.mock("next/cache", () => ({ unstable_cache: () => mocks.cached }));
vi.mock("@/db", () => ({ isDatabaseConfigured: () => true }));
vi.mock("./repository", () => ({ getReviewRepository: () => ({
  getManualMatchCacheStatus: mocks.cacheStatus,
  readManualMatchCacheSnapshot: mocks.snapshot,
  markManualMatchCacheDelivered: mocks.delivered,
  markManualMatchCacheDeliveryFailed: mocks.failed,
  getSubmissionCounts: mocks.counts,
  ping: mocks.ping,
}) }));

let getPublishedDatabaseMatches: typeof import("./public-matches")["getPublishedDatabaseMatches"];
let getDatabaseHealth: typeof import("./public-matches")["getDatabaseHealth"];
let writeManualMatchCacheFence: typeof import("./public-matches")["writeManualMatchCacheFence"];
let synchronizePublishedManualMatchesSnapshot: typeof import("./public-matches")["synchronizePublishedManualMatchesSnapshot"];

describe("manual match cache authoritative version checks", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const publicMatches = await import("./public-matches");
    getPublishedDatabaseMatches = publicMatches.getPublishedDatabaseMatches;
    getDatabaseHealth = publicMatches.getDatabaseHealth;
    writeManualMatchCacheFence = publicMatches.writeManualMatchCacheFence;
    synchronizePublishedManualMatchesSnapshot = publicMatches.synchronizePublishedManualMatchesSnapshot;
    mocks.cached.mockResolvedValue({ matches: [], fetchedAt: new Date().toISOString(), revision: 4 });
    mocks.cacheStatus.mockResolvedValue({ revision: 5, pendingRevisions: 0 });
    mocks.snapshot.mockResolvedValue({ rows: [], revision: 5, pendingRevisions: 1 });
    mocks.get.mockResolvedValue({ revision: 4 });
    mocks.set.mockResolvedValue(undefined);
    mocks.delivered.mockResolvedValue(undefined);
    mocks.failed.mockResolvedValue(undefined);
    mocks.counts.mockResolvedValue({ total: 0, pending: 0, approved: 0, rejected: 0 });
    mocks.ping.mockResolvedValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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

  it("retries Runtime Cache delivery when the outbox is pending despite matching cached revisions", async () => {
    mocks.cached.mockResolvedValue({ matches: [], fetchedAt: new Date().toISOString(), revision: 5 });
    mocks.cacheStatus.mockResolvedValue({ revision: 5, pendingRevisions: 1 });
    mocks.get.mockImplementation(async (key: string) => key.includes("fence")
      ? { revision: 5 }
      : { matches: [], fetchedAt: new Date().toISOString(), revision: 4 });

    const result = await getPublishedDatabaseMatches();

    expect(result.state.cacheRevision).toBe(5);
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    expect(mocks.delivered).toHaveBeenCalledWith(5);
  });

  it("reuses the payload when its revision matches PostgreSQL", async () => {
    mocks.cacheStatus.mockResolvedValue({ revision: 4, pendingRevisions: 0 });
    const result = await getPublishedDatabaseMatches();
    expect(result.state.cacheRevision).toBe(4);
    expect(mocks.cacheStatus).toHaveBeenCalledOnce();
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

  it("loads the generation selected by the Runtime Cache fence during a database outage", async () => {
    const latest = { matches: [], fetchedAt: "generation-5", revision: 5 };
    mocks.cacheStatus.mockRejectedValue(new Error("database unavailable"));
    mocks.cached.mockRejectedValue(new Error("database unavailable"));
    mocks.get.mockImplementation(async (key: string) => {
      if (key === "published-manual-matches-fence-v1") return { revision: 5 };
      if (key === "published-manual-matches-v1:5") return latest;
      return undefined;
    });

    const result = await getPublishedDatabaseMatches();

    expect(mocks.get).toHaveBeenCalledWith("published-manual-matches-v1:5");
    expect(result.state.status).toBe("cached");
    expect(result.state.cacheRevision).toBe(5);
    expect(result.state.lastSuccessfulReadAt).toBe("generation-5");
  });

  it("does not serve an older regional fallback after this instance already returned a newer generation", async () => {
    mocks.cacheStatus
      .mockResolvedValueOnce({ revision: 5, pendingRevisions: 0 })
      .mockRejectedValueOnce(new Error("database unavailable"));
    mocks.cached.mockResolvedValueOnce({ matches: [], fetchedAt: "fresh", revision: 4 });
    mocks.snapshot.mockResolvedValueOnce({ rows: [], revision: 5, pendingRevisions: 0 });
    mocks.get.mockImplementation(async (key: string) => key.includes("fence")
      ? { revision: 4 }
      : { matches: [], fetchedAt: "stale", revision: 4 });
    mocks.set.mockRejectedValueOnce(new Error("runtime cache unavailable"));

    const fresh = await getPublishedDatabaseMatches();
    expect(fresh.state.cacheRevision).toBe(5);
    expect(fresh.state.status).toBe("connected");

    const afterDatabaseFailure = await getPublishedDatabaseMatches();
    expect(afterDatabaseFailure.state.status).toBe("unavailable");
    expect(afterDatabaseFailure.state.cacheRevision).toBe(5);
    expect(afterDatabaseFailure.matches).toEqual([]);
  });

  it("keeps the health-observed generation as the minimum during a later database outage", async () => {
    mocks.cacheStatus
      .mockResolvedValueOnce({ revision: 5, pendingRevisions: 0 })
      .mockRejectedValueOnce(new Error("database unavailable"));
    const health = await getDatabaseHealth();
    expect(health.cacheRevision).toBe(5);

    mocks.get.mockImplementation(async (key: string) => key.includes("fence")
      ? { revision: 4 }
      : { matches: [], fetchedAt: "stale", revision: 4 });

    const afterDatabaseFailure = await getPublishedDatabaseMatches();
    expect(afterDatabaseFailure.state.status).toBe("unavailable");
    expect(afterDatabaseFailure.state.cacheRevision).toBe(5);
    expect(afterDatabaseFailure.matches).toEqual([]);
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

  it("keeps a delayed old snapshot write from replacing a newer Runtime Cache generation", async () => {
    const runtimeSnapshots = new Map<string, { revision: number }>();
    let releaseOldSnapshot!: () => void;
    let announceOldSnapshotWrite!: () => void;
    const oldSnapshotStarted = new Promise<void>((resolve) => {
      announceOldSnapshotWrite = resolve;
    });
    const oldSnapshotGate = new Promise<void>((resolve) => {
      releaseOldSnapshot = resolve;
    });
    mocks.set.mockImplementation(async (key: string, value: { revision: number }) => {
      if (value.revision === 4) {
        announceOldSnapshotWrite();
        await oldSnapshotGate;
      }
      runtimeSnapshots.set(key, value);
    });
    const repository = {
      readManualMatchCacheSnapshot: vi.fn()
        .mockResolvedValueOnce({ rows: [], revision: 4, pendingRevisions: 0 })
        .mockResolvedValueOnce({ rows: [], revision: 5, pendingRevisions: 0 }),
      markManualMatchCacheDelivered: mocks.delivered,
      markManualMatchCacheDeliveryFailed: mocks.failed,
    };

    const olderWrite = synchronizePublishedManualMatchesSnapshot(repository as never);
    await oldSnapshotStarted;
    await synchronizePublishedManualMatchesSnapshot(repository as never);
    releaseOldSnapshot();
    await olderWrite;

    expect(runtimeSnapshots.get("published-manual-matches-v1:5")?.revision).toBe(5);
    expect(runtimeSnapshots.get("published-manual-matches-v1:4")?.revision).toBe(4);
  });
});
