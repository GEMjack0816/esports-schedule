import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduleSyncWorker, invokeScheduleSync } from "./index.mjs";

const syncSecret = "test-only-secret-never-logged";

function response(overrides = {}, status = 200, extraHeaders = {}) {
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
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
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

  it("does not immediately repeat a completed all-provider-failure sync", async () => {
    let attempts = 0;
    const waits = [];
    await expect(invokeScheduleSync({
      secret: syncSecret,
      waitImpl: async (milliseconds) => waits.push(milliseconds),
      fetchImpl: async () => {
        attempts += 1;
        return response({
          ok: false,
          status: "failed",
          gamesSucceeded: 0,
          gamesFailed: 5,
          snapshotsPersisted: 0,
          errors: [{ game: "lol", code: "PANDASCORE_RATE_LIMITED", httpStatus: 429 }],
        }, 503);
      },
    })).rejects.toMatchObject({ code: "sync_failed", httpStatus: 503 });
    expect(attempts).toBe(1);
    expect(waits).toEqual([]);

    attempts = 0;
    await expect(invokeScheduleSync({
      secret: syncSecret,
      waitImpl: async (milliseconds) => waits.push(milliseconds),
      fetchImpl: async () => {
        attempts += 1;
        return response({
          ok: false,
          status: "not-configured",
          lockAcquired: false,
          generation: null,
          gamesAttempted: 0,
          gamesSucceeded: 0,
          gamesFailed: 0,
          snapshotsPersisted: 0,
          errors: [{ game: null, code: "PANDASCORE_NOT_CONFIGURED", httpStatus: null }],
        }, 503);
      },
    })).rejects.toMatchObject({ code: "sync_failed", httpStatus: 503 });
    expect(attempts).toBe(1);
    expect(waits).toEqual([]);

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

  it("honors Retry-After seconds and HTTP dates for 429 and transient 503 responses", async () => {
    for (const status of [429, 503]) {
      for (const retryAfter of ["12", new Date(12_000).toUTCString()]) {
        const waits = [];
        let attempts = 0;
        await expect(invokeScheduleSync({
          secret: syncSecret,
          nowImpl: () => 0,
          waitImpl: async (milliseconds) => waits.push(milliseconds),
          fetchImpl: async () => {
            attempts += 1;
            return attempts === 1 ? response({}, status, { "retry-after": retryAfter }) : response();
          },
        })).resolves.toMatchObject({ outcome: "success" });

        expect(attempts).toBe(2);
        expect(waits).toEqual([12_000]);
      }
    }
  });

  it("does not retry before an upstream Retry-After that exceeds the total budget", async () => {
    for (const status of [429, 503]) {
      const fetchImpl = vi.fn(async () => response({}, status, { "retry-after": "900" }));
      const waitImpl = vi.fn();
      await expect(invokeScheduleSync({ secret: syncSecret, fetchImpl, waitImpl })).rejects.toMatchObject({
        code: "retry_budget_exhausted",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(waitImpl).not.toHaveBeenCalled();
    }
  });

  it("caps all retries to a total budget below the Cron invocation wall-time limit", async () => {
    let now = 0;
    let attempts = 0;
    const timeoutBudgets = [];
    const result = await invokeScheduleSync({
      secret: syncSecret,
      nowImpl: () => now,
      timeoutSignalImpl: (milliseconds) => {
        timeoutBudgets.push(milliseconds);
        return new AbortController().signal;
      },
      waitImpl: async (milliseconds) => {
        // Simulate elapsed wall time between retries without sleeping.
        now += milliseconds === 500 ? 9 * 60_000 : 4 * 60_000;
      },
      fetchImpl: async () => {
        attempts += 1;
        return attempts < 3 ? response({}, 503) : response();
      },
    });

    expect(result.outcome).toBe("success");
    expect(attempts).toBe(3);
    expect(timeoutBudgets).toEqual([300_000, 300_000, 60_000]);
    expect(timeoutBudgets.reduce((total, timeout) => total + timeout, 0)).toBeLessThan(14 * 60_000);
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

  it("bounds response chunk count even when the stream emits empty chunks", async () => {
    let pullCount = 0;
    let canceled = false;
    const body = new ReadableStream({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new Uint8Array());
      },
      cancel() {
        canceled = true;
        return new Promise(() => {});
      },
    });

    await expect(invokeScheduleSync({
      secret: syncSecret,
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    })).rejects.toMatchObject({ code: "response_too_many_chunks", httpStatus: 200 });

    // ReadableStream may prefetch one additional chunk into its internal queue.
    expect(pullCount).toBeGreaterThan(1_024);
    expect(pullCount).toBeLessThanOrEqual(1_026);
    expect(canceled).toBe(true);
  });
});
