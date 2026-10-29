import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateSyncResponse } from "./validate-sync-response.mjs";

const success = {
  ok: true,
  status: "success",
  lockAcquired: true,
  generation: 41,
  gamesAttempted: 5,
  gamesSucceeded: 5,
  gamesFailed: 0,
  snapshotsPersisted: 5,
  lastSuccessfulSyncAt: new Date(Date.now() - 1_000).toISOString(),
  errors: [],
};

describe("sync workflow response validation", () => {
  it("uses the bounded sync runner without automatic request retries", () => {
    const workflow = readFileSync(new URL("../.github/workflows/sync-schedule.yml", import.meta.url), "utf8");
    const runner = readFileSync(new URL("./run-schedule-sync.mjs", import.meta.url), "utf8");
    const runBlock = workflow.slice(workflow.indexOf("        run: |"));

    expect(workflow).not.toMatch(/--retry(?:\s|=)|--retry-all-errors/);
    expect(workflow).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(workflow).toContain("node scripts/run-schedule-sync.mjs");
    expect(runner).toContain("const SYNC_TIMEOUT_MS = 300_000");
    expect(runner).toContain('authorization: `Bearer ${secret}`');
    expect(workflow).not.toMatch(/SYNC_URL:.*CRON_SECRET/);
    expect(runBlock).not.toMatch(/\bcurl\b/);
  });

  it("accepts a complete successful refresh", () => {
    expect(validateSyncResponse(success, 200).ok).toBe(true);
  });

  it.each([Number.NaN, 99, 200.5, 600, "200"])(
    "rejects an invalid HTTP status (%s)",
    (httpStatus) => {
      expect(validateSyncResponse(success, httpStatus).ok).toBe(false);
    },
  );

  it.each([false, undefined])("requires explicit ok=true (%s)", (ok) => {
    const payload = { ...success };
    if (ok === undefined) delete payload.ok;
    else payload.ok = ok;
    expect(validateSyncResponse(payload, 200)).toEqual({
      ok: false,
      message: "sync endpoint did not confirm a successful response",
    });
  });

  it("rejects a success-shaped response that attempted fewer or more than all five games", () => {
    for (const gamesAttempted of [4, 6]) {
      expect(validateSyncResponse({ ...success, gamesAttempted }, 200)).toMatchObject({
        ok: false,
        message: "sync did not attempt the complete five-game catalog",
      });
    }
  });

  it("rejects impossible counts and a success status that contradicts its counts", () => {
    const invalidPayloads = [
      { ...success, gamesSucceeded: 6, gamesFailed: -1 },
      { ...success, gamesSucceeded: 4, gamesFailed: 1 },
      { ...success, gamesFailed: -1 },
      { ...success, status: "partial", gamesSucceeded: 4, gamesFailed: 1, snapshotsPersisted: 4 },
    ];
    for (const payload of invalidPayloads) {
      expect(validateSyncResponse(payload, 200).ok).toBe(false);
    }
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

  it("accepts partial success only when a valid diagnostic accompanies the partial result", () => {
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

  it("accepts partial sync diagnostics even when all game snapshots persisted", () => {
    expect(validateSyncResponse({
      ...success,
      status: "partial",
      errors: [{ game: "lol", code: "CACHE_WRITE", httpStatus: null }],
    }, 200).ok).toBe(true);
  });

  it("rejects a partial result without a valid errors array", () => {
    expect(validateSyncResponse({ ...success, status: "partial" }, 200)).toMatchObject({
      ok: false,
      message: "sync status does not match game outcome counts",
    });
    expect(validateSyncResponse({ ...success, errors: null }, 200)).toMatchObject({
      ok: false,
      message: "sync did not report a valid error summary",
    });
  });

  it("does not copy an untrusted logical status into the workflow output", () => {
    const result = validateSyncResponse({
      ...success,
      status: "marker\nBearer should-not-be-logged",
    }, 200);
    expect(result).toEqual({
      ok: false,
      message: "sync reported an unrecognized logical status",
    });
    expect(result.message).not.toContain("marker");
  });

  it("rejects missing fencing generation, all-provider failure, and missing snapshots", () => {
    expect(validateSyncResponse({ ...success, generation: null }, 200).ok).toBe(false);
    expect(validateSyncResponse({
      ...success,
      ok: false,
      status: "failed",
      gamesSucceeded: 0,
      gamesFailed: 5,
      snapshotsPersisted: 0,
    }, 200).ok).toBe(false);
    expect(validateSyncResponse({ ...success, snapshotsPersisted: 0 }, 200).ok).toBe(false);
  });

  it("rejects a busy response that claims a generation or uses an unexpected status", () => {
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: null }, 500).ok).toBe(false);
    expect(validateSyncResponse({ status: "busy", lockAcquired: false, generation: 41 }, 409).ok).toBe(false);
  });
});
