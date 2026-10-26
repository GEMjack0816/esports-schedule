import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
};

describe("sync workflow response validation", () => {
  it("accepts a complete successful refresh", () => {
    expect(validateSyncResponse(success, 200).ok).toBe(true);
  });

  it("fails the workflow for a clearly reported busy lock without treating it as a refresh", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: null }, 409)).toEqual({
      ok: false,
      message: "sync busy: another refresh owns the lock; this run did not refresh the schedule",
    });
  });

  it("exits non-zero when the workflow CLI receives a structured busy response", () => {
    const directory = mkdtempSync(join(tmpdir(), "sync-response-validator-"));
    const responsePath = join(directory, "response.json");
    const scriptPath = fileURLToPath(new URL("./validate-sync-response.mjs", import.meta.url));

    try {
      writeFileSync(responsePath, JSON.stringify({
        status: "busy",
        lockAcquired: false,
        generation: null,
      }));
      const result = spawnSync(process.execPath, [scriptPath, responsePath, "409"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("sync busy: another refresh owns the lock");
      expect(result.stdout).toContain("this run did not refresh the schedule");
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
