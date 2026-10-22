import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateSyncResponse } from "./validate-sync-response.mjs";

const success = {
  status: "success",
  lockAcquired: true,
  generation: 41,
  gamesAttempted: 5,
  gamesSucceeded: 5,
  gamesFailed: 0,
  snapshotsPersisted: 5,
  lastSuccessfulSyncAt: "2026-08-30T00:00:00.000Z",
  errors: [],
};

describe("sync workflow response validation", () => {
  it("accepts a complete successful refresh", () => {
    expect(validateSyncResponse(success, 200).ok).toBe(true);
  });

  it.each([
    "1",
    "2026-02-31T00:00:00.000Z",
    "2026-08-30T00:00:00Z",
    "2026-08-30T00:00:00.000+00:00",
  ])("rejects non-canonical or normalized timestamps: %s", (lastSuccessfulSyncAt) => {
    expect(validateSyncResponse({ ...success, lastSuccessfulSyncAt }, 200)).toMatchObject({
      ok: false,
      message: "sync did not report a canonical UTC lastSuccessfulSyncAt",
    });
  });

  it("rejects malformed HTTP status codes instead of accepting a successful payload", () => {
    expect(validateSyncResponse(success, Number.NaN)).toEqual({
      ok: false,
      message: "sync endpoint returned an invalid HTTP status",
    });
    expect(validateSyncResponse(success, 99).ok).toBe(false);
    expect(validateSyncResponse(success, 600).ok).toBe(false);
  });

  it("rejects a busy lock so scheduled automation does not report a refresh", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: null }, 409)).toEqual({
      ok: false,
      message: "sync busy: another refresh owns the lock; this invocation did not refresh",
    });
  });

  it("exits non-zero in CLI mode when a lock-busy response is received", () => {
    const directory = mkdtempSync(join(tmpdir(), "esports-sync-validator-"));
    const responseFile = join(directory, "response.json");

    try {
      writeFileSync(responseFile, JSON.stringify({
        status: "busy",
        lockAcquired: false,
        generation: null,
      }));
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL("./validate-sync-response.mjs", import.meta.url)),
        responseFile,
        "409",
      ], { encoding: "utf8" });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("this invocation did not refresh");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts partial success with a valid fencing generation", () => {
    expect(validateSyncResponse({
      ...success,
      status: "partial",
      generation: 42,
      gamesSucceeded: 4,
      gamesFailed: 1,
      snapshotsPersisted: 4,
      errors: [{ game: "lol", code: "PROVIDER_HTTP_503", httpStatus: 503 }],
    }, 200).ok).toBe(true);
  });

  it("accepts a partial cache-write diagnostic when every durable game snapshot succeeded", () => {
    expect(validateSyncResponse({
      ...success,
      status: "partial",
      errors: [{ game: "lol", code: "CACHE_WRITE", httpStatus: null }],
    }, 200)).toEqual({
      ok: true,
      message: "partial: 5 games updated, 0 failed, 1 sync diagnostic(s)",
    });
  });

  it("rejects success or partial responses without a valid fencing generation", () => {
    expect(validateSyncResponse({ ...success, generation: null }, 200).ok).toBe(false);
    expect(validateSyncResponse({ ...success, status: "partial", generation: 0 }, 200).ok).toBe(false);
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

  it("rejects impossible game counts and statuses that contradict the counts", () => {
    const invalidPayloads = [
      { ...success, gamesAttempted: 4, gamesSucceeded: 5, gamesFailed: -1 },
      { ...success, gamesAttempted: 4, gamesSucceeded: 4, gamesFailed: 0, snapshotsPersisted: 4 },
      { ...success, status: "partial", gamesAttempted: 6, gamesSucceeded: 5, gamesFailed: 1 },
      { ...success, gamesFailed: -1, gamesAttempted: 4 },
      { ...success, status: "success", gamesSucceeded: 4, gamesFailed: 1 },
      { ...success, status: "partial", gamesSucceeded: 5, gamesFailed: 0, errors: [] },
      { ...success, status: "success", errors: [{ game: "lol", code: "CACHE_WRITE" }] },
      { ...success, status: "success", gamesSucceeded: 4, gamesFailed: 1 },
      { ...success, status: "partial", gamesSucceeded: 5, gamesFailed: 0 },
    ];

    for (const payload of invalidPayloads) {
      expect(validateSyncResponse(payload, 200).ok).toBe(false);
    }
  });

  it("rejects a busy payload returned with an unexpected HTTP status", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: null }, 500).ok).toBe(false);
  });

  it("rejects a busy response that claims a generation", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: 41 }, 409).ok).toBe(false);
  });
});
