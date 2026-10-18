import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduleSyncWorker, invokeScheduleSync } from "./index.mjs";

const syncSecret = "test-only-secret-never-logged";

function response(overrides = {}, status = 200) {
  return new Response(JSON.stringify({
    ok: true,
    status: "success",
    lockAcquired: true,
    generation: 12,
    gamesAttempted: 5,
    gamesSucceeded: 5,
    gamesFailed: 0,
    snapshotsPersisted: 5,
    lastSuccessfulSyncAt: "2026-10-18T10:00:00.000Z",
    ...overrides,
  }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("schedule sync Worker client", () => {
  it("sends the existing bearer credential only in the Authorization header", async () => {
    let requestedUrl;
    let requestOptions;
    const result = await invokeScheduleSync({
      secret: syncSecret,
      waitImpl: async () => {},
      fetchImpl: async (url, options) => {
        requestedUrl = url;
        requestOptions = options;
        return response();
      },
    });

    expect(result).toMatchObject({
      outcome: "success",
      generation: 12,
      gamesSucceeded: 5,
      gamesFailed: 0,
      snapshotsPersisted: 5,
    });
    expect(requestedUrl).toBe("https://esports-schedule-two.vercel.app/api/cron/sync");
    expect(requestedUrl).not.toContain(syncSecret);
    expect(requestOptions.method).toBe("GET");
    expect(requestOptions.headers.authorization).toBe(`Bearer ${syncSecret}`);
    expect(requestOptions.headers["cache-control"]).toBe("no-store");
    expect(requestOptions.redirect).toBe("error");
  });

  it("rejects missing configuration without making a request", async () => {
    const fetchImpl = vi.fn();
    await expect(invokeScheduleSync({ secret: "", fetchImpl })).rejects.toMatchObject({
      code: "missing_configuration",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports partial success with the real generation and persisted count", async () => {
    await expect(invokeScheduleSync({
      secret: syncSecret,
      fetchImpl: async () => response({
        status: "partial",
        gamesSucceeded: 4,
        gamesFailed: 1,
        snapshotsPersisted: 4,
      }),
    })).resolves.toMatchObject({
      outcome: "partial",
      generation: 12,
      gamesAttempted: 5,
      gamesSucceeded: 4,
      gamesFailed: 1,
      snapshotsPersisted: 4,
    });
  });

  it("treats a valid lock conflict as a distinct skipped outcome", async () => {
    await expect(invokeScheduleSync({
      secret: syncSecret,
      fetchImpl: async () => response({
        ok: false,
        status: "busy",
        lockAcquired: false,
        generation: null,
      }, 409),
    })).resolves.toEqual({ outcome: "skipped_busy", generation: null });
  });

  it("fails closed for all-provider-failure responses and inconsistent snapshot counts", async () => {
    await expect(invokeScheduleSync({
      secret: syncSecret,
      fetchImpl: async () => response({
        ok: false,
        status: "failed",
        gamesSucceeded: 0,
        gamesFailed: 5,
        snapshotsPersisted: 0,
      }, 503),
    })).rejects.toMatchObject({ code: "http_failure", httpStatus: 503 });

    await expect(invokeScheduleSync({
      secret: syncSecret,
      fetchImpl: async () => response({ snapshotsPersisted: 4 }),
    })).rejects.toMatchObject({ code: "snapshot_persistence_mismatch" });
  });

  it("retries bounded 5xx failures and accepts only a validated subsequent result", async () => {
    const waits = [];
    let attempts = 0;
    const result = await invokeScheduleSync({
      secret: syncSecret,
      waitImpl: async (milliseconds) => waits.push(milliseconds),
      fetchImpl: async () => {
        attempts += 1;
        return attempts < 3 ? response({}, 503) : response();
      },
    });

    expect(result.outcome).toBe("success");
    expect(attempts).toBe(3);
    expect(waits).toEqual([500, 1_000]);
  });

  it("stops after three network failures without exposing transport details", async () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const worker = createScheduleSyncWorker({
      fetchImpl: async () => { throw new Error(`private transport detail ${syncSecret}`); },
      log,
      waitImpl: async () => {},
    });
    const noRetry = vi.fn();
    await expect(worker.scheduled({ scheduledTime: 1, noRetry }, { CRON_SECRET: syncSecret }))
      .rejects.toThrow("schedule sync invocation failed");
    expect(noRetry).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(syncSecret);
  });

  it("does not expose an HTTP endpoint for triggering production sync", async () => {
    const worker = createScheduleSyncWorker();
    const result = await worker.fetch(new Request("https://worker.example/run", { method: "POST" }));
    expect(result.status).toBe(404);
  });

  it("keeps the optional backup schedule independent and without a public Worker route", async () => {
    const configuration = JSON.parse(await (await import("node:fs/promises")).readFile(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    ));
    expect(configuration.triggers.crons).toEqual(["5,20,35,50 * * * *"]);
    expect(configuration.workers_dev).toBe(false);
  });

  it("logs only a safe summary and does not log the secret or provider body", async () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const worker = createScheduleSyncWorker({ fetchImpl: async () => response(), log });
    const result = await worker.scheduled({ scheduledTime: Date.parse("2026-10-18T10:00:00Z"), noRetry: vi.fn() }, {
      CRON_SECRET: syncSecret,
    });

    const serializedLogs = JSON.stringify({ log: log.log.mock.calls, warn: log.warn.mock.calls, error: log.error.mock.calls });
    expect(result).toMatchObject({ outcome: "success", generation: 12 });
    expect(serializedLogs).toContain("schedule_sync");
    expect(serializedLogs).not.toContain(syncSecret);
    expect(serializedLogs).not.toContain("errors");
    expect(log.log).toHaveBeenCalledTimes(1);
  });

  it("records busy outcomes as warnings without claiming a refresh", async () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const worker = createScheduleSyncWorker({
      fetchImpl: async () => response({ ok: false, status: "busy", lockAcquired: false, generation: null }, 409),
      log,
    });
    const result = await worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret });

    expect(result).toEqual({ outcome: "skipped_busy", generation: null });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.log).not.toHaveBeenCalled();
  });

  it("sanitizes failed-run logs", async () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const worker = createScheduleSyncWorker({
      fetchImpl: async () => { throw new Error(`transport ${syncSecret}`); },
      log,
      waitImpl: async () => {},
    });
    await expect(worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret }))
      .rejects.toThrow("schedule sync invocation failed");

    const record = JSON.parse(log.error.mock.calls[0][0]);
    expect(record).toMatchObject({ code: "network_failure", httpStatus: null });
    expect(JSON.stringify(record)).not.toContain(syncSecret);
    expect(JSON.stringify(record)).not.toContain("transport");
  });

  it("uses a strict no-store response policy and a bounded parser", async () => {
    await expect(invokeScheduleSync({
      secret: syncSecret,
      fetchImpl: async () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    })).rejects.toMatchObject({ code: "invalid_content_type" });

    await expect(invokeScheduleSync({
      secret: syncSecret,
      fetchImpl: async () => new Response("x".repeat(32 * 1024 + 1), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    })).rejects.toMatchObject({ code: "response_too_large" });
  });
});
