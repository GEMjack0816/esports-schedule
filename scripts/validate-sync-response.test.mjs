import { describe, expect, it } from "vitest";
import { validateSyncResponse } from "./validate-sync-response.mjs";

const now = Date.parse("2026-10-16T06:00:00.000Z");

const success = {
  status: "success",
  lockAcquired: true,
  generation: 41,
  gamesAttempted: 5,
  gamesSucceeded: 5,
  gamesFailed: 0,
  snapshotsPersisted: 5,
  lastSuccessfulSyncAt: "2026-10-16T05:58:00.000Z",
  sourceFetchedAt: "2026-10-16T05:58:00.000Z",
};

describe("sync workflow response validation", () => {
  it("accepts a complete successful refresh", () => {
    expect(validateSyncResponse(success, 200, now).ok).toBe(true);
  });

  it("accepts a clearly reported busy lock without treating it as a refresh", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: null }, 409)).toEqual({
      ok: true,
      message: "sync busy: another refresh owns the lock",
    });
  });

  it("accepts partial success with a valid fencing generation", () => {
    expect(validateSyncResponse({
      ...success,
      status: "partial",
      generation: 42,
      gamesSucceeded: 4,
      gamesFailed: 1,
      snapshotsPersisted: 4,
    }, 200, now).ok).toBe(true);
  });

  it("rejects success or partial responses without a valid fencing generation", () => {
    expect(validateSyncResponse({ ...success, generation: null }, 200, now).ok).toBe(false);
    expect(validateSyncResponse({ ...success, status: "partial", generation: 0 }, 200, now).ok).toBe(false);
  });

  it("rejects HTTP success when every game failed", () => {
    expect(validateSyncResponse({
      ...success,
      status: "failed",
      gamesSucceeded: 0,
      gamesFailed: 5,
      snapshotsPersisted: 0,
    }, 200, now).ok).toBe(false);
  });

  it("rejects a logical success that did not persist a snapshot", () => {
    expect(validateSyncResponse({ ...success, snapshotsPersisted: 0 }, 200, now).ok).toBe(false);
  });

  it("rejects a busy payload returned with an unexpected HTTP status", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: null }, 500).ok).toBe(false);
  });

  it("rejects a busy response that claims a generation", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: 41 }, 409).ok).toBe(false);
  });

  it("accepts source snapshots exactly at the 15-minute freshness boundary", () => {
    const boundary = new Date(now - 15 * 60 * 1_000).toISOString();
    expect(validateSyncResponse({
      ...success,
      sourceFetchedAt: boundary,
      lastSuccessfulSyncAt: boundary,
    }, 200, now).ok).toBe(true);
  });

  it("rejects an old source snapshot even when another game synced recently", () => {
    expect(validateSyncResponse({
      ...success,
      sourceFetchedAt: new Date(now - 15 * 60 * 1_000 - 1).toISOString(),
      lastSuccessfulSyncAt: new Date(now - 60_000).toISOString(),
    }, 200, now)).toEqual({
      ok: false,
      message: "sync snapshot sourceFetchedAt is missing, stale, or too far in the future",
    });
  });

  it("rejects a stale last successful sync timestamp", () => {
    expect(validateSyncResponse({
      ...success,
      lastSuccessfulSyncAt: new Date(now - 15 * 60 * 1_000 - 1).toISOString(),
    }, 200, now).ok).toBe(false);
  });

  it("rejects missing, malformed, inconsistent, or implausibly future timestamps", () => {
    expect(validateSyncResponse({ ...success, sourceFetchedAt: null }, 200, now).ok).toBe(false);
    expect(validateSyncResponse({ ...success, sourceFetchedAt: "not-a-date" }, 200, now).ok).toBe(false);
    expect(validateSyncResponse({
      ...success,
      lastSuccessfulSyncAt: new Date(now - 60_000).toISOString(),
      sourceFetchedAt: new Date(now).toISOString(),
    }, 200, now).ok).toBe(false);
    expect(validateSyncResponse({
      ...success,
      sourceFetchedAt: new Date(now + 2 * 60 * 1_000 + 1).toISOString(),
      lastSuccessfulSyncAt: new Date(now + 2 * 60 * 1_000 + 1).toISOString(),
    }, 200, now).ok).toBe(false);
  });
});
