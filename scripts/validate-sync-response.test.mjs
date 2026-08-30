import { describe, expect, it } from "vitest";
import { validateSyncResponse } from "./validate-sync-response.mjs";

const success = {
  status: "success",
  lockAcquired: true,
  gamesAttempted: 5,
  gamesSucceeded: 5,
  gamesFailed: 0,
  snapshotsPersisted: 5,
  lastSuccessfulSyncAt: "2026-08-30T00:00:00.000Z",
};

describe("sync workflow response validation", () => {
  it("accepts a complete successful refresh", () => {
    expect(validateSyncResponse(success, 200).ok).toBe(true);
  });

  it("accepts a clearly reported busy lock without treating it as a refresh", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false }, 409)).toEqual({
      ok: true,
      message: "sync busy: another refresh owns the lock",
    });
  });

  it("rejects HTTP success when every game failed", () => {
    expect(validateSyncResponse({
      ...success,
      status: "failed",
      gamesSucceeded: 0,
      gamesFailed: 5,
      snapshotsPersisted: 0,
    }, 200).ok).toBe(false);
  });

  it("rejects a logical success that did not persist a snapshot", () => {
    expect(validateSyncResponse({ ...success, snapshotsPersisted: 0 }, 200).ok).toBe(false);
  });

  it("rejects a busy payload returned with an unexpected HTTP status", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false }, 500).ok).toBe(false);
  });
});
