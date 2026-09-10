import { describe, expect, it } from "vitest";
import { validateSyncResponse } from "./validate-sync-response.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const success = {
  status: "success",
  lockAcquired: true,
  generation: 41,
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

  it("reports a busy lock as non-success because this run did not refresh data", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: null }, 409)).toEqual({
      ok: false,
      message: "sync skipped: another refresh owns the lock; this run did not refresh data",
    });
  });

  it.each([
    [success, 200, 0],
    [{ status: "busy", lockAcquired: false, generation: null }, 409, 1],
  ])("propagates the refresh outcome through the CLI exit code", (payload, status, exitCode) => {
    const directory = mkdtempSync(join(tmpdir(), "sync-validator-test-"));
    try {
      const responseFile = join(directory, "response.json");
      writeFileSync(responseFile, JSON.stringify(payload));
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL("./validate-sync-response.mjs", import.meta.url)),
        responseFile,
        String(status),
      ], { encoding: "utf8" });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(exitCode);
      if (exitCode === 1) expect(result.stdout).toContain("sync skipped");
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
    }, 200).ok).toBe(true);
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

  it("rejects a busy payload returned with an unexpected HTTP status", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: null }, 500).ok).toBe(false);
  });

  it("rejects a busy response that claims a generation", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: 41 }, 409).ok).toBe(false);
  });
});
