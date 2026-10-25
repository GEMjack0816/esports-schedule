import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSyncResponse } from "./validate-sync-response.mjs";

const validatorPath = fileURLToPath(new URL("./validate-sync-response.mjs", import.meta.url));

const success = {
  ok: true,
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

  it.each([Number.NaN, 0, 600])("rejects an invalid HTTP status (%s)", (httpStatus) => {
    expect(validateSyncResponse(success, httpStatus)).toEqual({
      ok: false,
      message: "sync response has an invalid HTTP status",
    });
  });

  it.each([false, undefined])("rejects a success-shaped response without explicit ok=true (%s)", (ok) => {
    const payload = { ...success };
    if (ok === undefined) delete payload.ok;
    else payload.ok = ok;
    expect(validateSyncResponse(payload, 200)).toEqual({
      ok: false,
      message: "sync endpoint did not confirm a successful response",
    });
  });

  it("fails the workflow when another refresh owns the lock", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: null }, 409)).toEqual({
      ok: false,
      message: "sync skipped: another refresh owns the lock",
    });
  });

  it("exits non-zero for lock contention so GitHub Actions cannot report a false success", () => {
    const directory = mkdtempSync(join(tmpdir(), "sync-response-validator-"));
    const responsePath = join(directory, "response.json");
    try {
      writeFileSync(responsePath, JSON.stringify({
        status: "busy",
        lockAcquired: false,
        generation: null,
      }));
      const result = spawnSync(process.execPath, [validatorPath, responsePath, "409"], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("sync skipped: another refresh owns the lock");
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

  it.each([4, 6])("rejects a sync that attempts %i games instead of all five", (gamesAttempted) => {
    expect(validateSyncResponse({ ...success, gamesAttempted }, 200)).toEqual({
      ok: false,
      message: "sync did not attempt all five configured games",
    });
  });

  it.each([
    { gamesSucceeded: 6, gamesFailed: -1, snapshotsPersisted: 6 },
    { gamesSucceeded: 4, gamesFailed: -1, snapshotsPersisted: 4 },
  ])("rejects impossible success/failure counts: %o", (counts) => {
    expect(validateSyncResponse({ ...success, ...counts }, 200).ok).toBe(false);
  });

  it.each([
    { status: "success", gamesSucceeded: 4, gamesFailed: 1, snapshotsPersisted: 4 },
    { status: "partial", gamesSucceeded: 5, gamesFailed: 0, snapshotsPersisted: 5 },
  ])("rejects a logical status inconsistent with the game outcomes: %o", (counts) => {
    expect(validateSyncResponse({ ...success, ...counts }, 200)).toEqual({
      ok: false,
      message: "sync logical status does not match game outcome counts",
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

  it("does not echo an unsupported response status into workflow logs", () => {
    const injectedStatus = "unknown\n::warning::forged workflow annotation";
    expect(validateSyncResponse({ ...success, status: injectedStatus }, 200)).toEqual({
      ok: false,
      message: "sync endpoint reported an unsupported logical status",
    });
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
