import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduleSyncWorker, invokeScheduleSync } from "./index.mjs";

const syncSecret = "test-only-secret-never-logged";
const healthUrl = "https://esports-schedule-two.vercel.app/api/health/data-coverage";
const pandaGames = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"];

function healthResponse(overrides = {}, status = 200, cacheControl = "no-store, no-cache, must-revalidate") {
  return new Response(JSON.stringify({
    demoMode: false,
    mode: "live",
    stale: false,
    refreshInProgress: false,
    providers: { pandascore: "connected" },
    sourceFetchedAt: "2026-10-18T09:55:00.000Z",
    lastSuccessfulSyncAt: "2026-10-18T09:55:00.000Z",
    snapshotAgeSeconds: 300,
    games: Object.fromEntries(pandaGames.map((game) => [game, { syncStatus: "normal" }])),
    ...overrides,
  }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(cacheControl === null ? {} : { "cache-control": cacheControl }),
    },
  });
}

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
    sourceFetchedAt: "2026-10-18T09:59:59.000Z",
    lastSuccessfulSyncAt: "2026-10-18T10:00:00.000Z",
    refreshedAt: "2026-10-18T10:00:01.000Z",
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
      sourceFetchedAt: "2026-10-18T09:59:59.000Z",
      lastSuccessfulSyncAt: "2026-10-18T10:00:00.000Z",
      refreshedAt: "2026-10-18T10:00:01.000Z",
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

  it("rejects sync responses that did not attempt exactly all five games", async () => {
    const incompleteResponses = [
      { status: "success", gamesAttempted: 1, gamesSucceeded: 1, gamesFailed: 0, snapshotsPersisted: 1 },
      { status: "success", gamesAttempted: 4, gamesSucceeded: 4, gamesFailed: 0, snapshotsPersisted: 4 },
      { status: "partial", gamesAttempted: 4, gamesSucceeded: 3, gamesFailed: 1, snapshotsPersisted: 3 },
      { status: "success", gamesAttempted: 6, gamesSucceeded: 6, gamesFailed: 0, snapshotsPersisted: 6 },
    ];

    for (const payload of incompleteResponses) {
      await expect(invokeScheduleSync({
        secret: syncSecret,
        fetchImpl: async () => response(payload),
      })).rejects.toMatchObject({ code: "invalid_game_counts" });
    }
  });

  it("requires ordered source, successful-sync, and response timestamps", async () => {
    const invalidTimestampResponses = [
      { sourceFetchedAt: null },
      { sourceFetchedAt: "2026-02-30T10:00:00.000Z" },
      { lastSuccessfulSyncAt: "2026-10-18T10:00:00" },
      { refreshedAt: null },
      { refreshedAt: "2026-02-30T10:00:00.000Z" },
      { sourceFetchedAt: "2026-10-18T10:00:01.000Z" },
      { lastSuccessfulSyncAt: "2026-10-18T10:00:02.000Z" },
    ];

    for (const payload of invalidTimestampResponses) {
      await expect(invokeScheduleSync({
        secret: syncSecret,
        fetchImpl: async () => response(payload),
      })).rejects.toMatchObject({ code: "invalid_success_timestamp" });
    }
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

  it("reconciles an ambiguous 5xx through health instead of replaying the sync", async () => {
    const requests = [];
    const result = await invokeScheduleSync({
      secret: syncSecret,
      baselineLastSuccessfulSyncAt: Date.parse("2026-10-18T09:50:00.000Z"),
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      fetchImpl: async (url) => {
        requests.push(url);
        return url === healthUrl ? healthResponse() : response({}, 503);
      },
    });

    expect(result).toMatchObject({ outcome: "verified_fresh_after_ambiguous_response", snapshotAgeSeconds: 300 });
    expect(requests).toEqual([
      "https://esports-schedule-two.vercel.app/api/cron/sync",
      healthUrl,
    ]);
  });

  it("fails closed after an ambiguous 5xx when health does not prove a newer successful sync", async () => {
    const requests = [];
    const waits = [];
    await expect(invokeScheduleSync({
      secret: syncSecret,
      baselineLastSuccessfulSyncAt: Date.parse("2026-10-18T09:55:00.000Z"),
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      waitImpl: async (milliseconds) => waits.push(milliseconds),
      fetchImpl: async (url) => {
        requests.push(url);
        return url === healthUrl ? healthResponse() : response({}, 503);
      },
    })).rejects.toMatchObject({ code: "ambiguous_sync_failure", httpStatus: 503 });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe("https://esports-schedule-two.vercel.app/api/cron/sync");
    expect(requests[1]).toBe(healthUrl);
    expect(waits).toEqual([]);
  });

  it("accepts a lost network response only when a fresh successful sync advanced", async () => {
    const requests = [];
    const result = await invokeScheduleSync({
      secret: syncSecret,
      baselineLastSuccessfulSyncAt: Date.parse("2026-10-18T09:50:00.000Z"),
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      fetchImpl: async (url) => {
        requests.push(url);
        if (url === healthUrl) {
          return healthResponse({
            lastSuccessfulSyncAt: "2026-10-18T09:59:30.000Z",
            sourceFetchedAt: "2026-10-18T09:59:30.000Z",
            snapshotAgeSeconds: 30,
          });
        }
        throw new Error("response lost after dispatch");
      },
    });

    expect(result).toMatchObject({ outcome: "verified_fresh_after_ambiguous_response", snapshotAgeSeconds: 30 });
    expect(requests).toEqual([
      "https://esports-schedule-two.vercel.app/api/cron/sync",
      healthUrl,
    ]);
  });

  it("fails closed when a lost network response is not followed by an advanced snapshot", async () => {
    const requests = [];
    await expect(invokeScheduleSync({
      secret: syncSecret,
      baselineLastSuccessfulSyncAt: Date.parse("2026-10-18T09:55:00.000Z"),
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      fetchImpl: async (url) => {
        requests.push(url);
        if (url === healthUrl) return healthResponse();
        throw new Error("response lost after dispatch");
      },
    })).rejects.toMatchObject({ code: "ambiguous_sync_failure" });
    expect(requests).toEqual([
      "https://esports-schedule-two.vercel.app/api/cron/sync",
      healthUrl,
    ]);
  });

  it("does not retry a transient non-JSON response when body cancellation never settles", async () => {
    const cancel = vi.fn(() => new Promise(() => {}));
    let attempts = 0;
    const result = await Promise.race([
      invokeScheduleSync({
        secret: syncSecret,
        waitImpl: async () => {},
        fetchImpl: async () => {
          attempts += 1;
          if (attempts > 1) return healthResponse({
            lastSuccessfulSyncAt: "2026-10-18T09:59:30.000Z",
            sourceFetchedAt: "2026-10-18T09:59:30.000Z",
            snapshotAgeSeconds: 30,
          });
          return {
            status: 503,
            headers: new Headers({ "content-type": "text/plain" }),
            body: { cancel },
          };
        },
        baselineLastSuccessfulSyncAt: Date.parse("2026-10-18T09:55:00.000Z"),
        nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      }).then((value) => ({ kind: "result", value })),
      new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 100)),
    ]);

    expect(result.kind).toBe("result");
    expect(result.value).toMatchObject({ outcome: "verified_fresh_after_ambiguous_response", snapshotAgeSeconds: 30 });
    expect(attempts).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After seconds and HTTP dates for explicit 429 rejections", async () => {
    for (const retryAfter of ["12", new Date(12_000).toUTCString()]) {
      const waits = [];
      let attempts = 0;
      await expect(invokeScheduleSync({
        secret: syncSecret,
        nowImpl: () => 0,
        waitImpl: async (milliseconds) => waits.push(milliseconds),
        fetchImpl: async () => {
          attempts += 1;
          return attempts === 1 ? response({}, 429, { "retry-after": retryAfter }) : response();
        },
      })).resolves.toMatchObject({ outcome: "success" });

      expect(attempts).toBe(2);
      expect(waits).toEqual([12_000]);
    }
  });

  it("does not retry before an upstream Retry-After that exceeds the total budget", async () => {
    const fetchImpl = vi.fn(async () => response({}, 429, { "retry-after": "900" }));
    const waitImpl = vi.fn();
    await expect(invokeScheduleSync({ secret: syncSecret, fetchImpl, waitImpl })).rejects.toMatchObject({
      code: "retry_budget_exhausted",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waitImpl).not.toHaveBeenCalled();
  });

  it("caps explicit 429 retries to a total budget below the Cron invocation wall-time limit", async () => {
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
        return attempts < 3 ? response({}, 429) : response();
      },
    });

    expect(result.outcome).toBe("success");
    expect(attempts).toBe(3);
    expect(timeoutBudgets).toEqual([300_000, 300_000, 60_000]);
    expect(timeoutBudgets.reduce((total, timeout) => total + timeout, 0)).toBeLessThan(14 * 60_000);
  });

  it("stops after one ambiguous network failure without exposing transport details", async () => {
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
    expect(JSON.stringify(log.error.mock.calls)).toContain("ambiguous_sync_failure");
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

  it("keeps backup cron minute slots separate from the GitHub sync schedule", async () => {
    const { readFile } = await import("node:fs/promises");
    const [configuration, workflow] = await Promise.all([
      readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8").then(JSON.parse),
      readFile(new URL("../../../.github/workflows/sync-schedule.yml", import.meta.url), "utf8"),
    ]);
    const githubCrons = [...workflow.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']\s*$/gm)]
      .map((match) => match[1]);
    const workerCrons = configuration.triggers.crons;

    expect(githubCrons.length).toBeGreaterThan(0);
    expect(workerCrons.length).toBeGreaterThan(0);

    const minuteSlots = (expression) => {
      const minuteField = expression.trim().split(/\s+/)[0];
      const step = minuteField.match(/^\*\/(\d+)$/);
      if (step) {
        const interval = Number(step[1]);
        if (!Number.isInteger(interval) || interval < 1 || interval > 60) return null;
        return Array.from({ length: Math.ceil(60 / interval) }, (_, index) => index * interval);
      }
      if (minuteField === "*") return Array.from({ length: 60 }, (_, minute) => minute);
      if (!/^\d+(?:,\d+)*$/.test(minuteField)) return null;
      const values = minuteField.split(",").map(Number);
      return values.every((minute) => Number.isInteger(minute) && minute >= 0 && minute < 60) ? values : null;
    };

    for (const githubCron of githubCrons) {
      const githubSlots = minuteSlots(githubCron);
      expect(githubSlots, `unsupported GitHub cron minute syntax: ${githubCron}`).not.toBeNull();
      const githubMinutes = new Set(githubSlots);
      for (const workerCron of workerCrons) {
        const workerSlots = minuteSlots(workerCron);
        expect(workerSlots, `unsupported Worker cron minute syntax: ${workerCron}`).not.toBeNull();
        const collisions = workerSlots.filter((minute) => githubMinutes.has(minute));
        expect(collisions, `${githubCron} overlaps ${workerCron} at minute(s) ${collisions.join(", ")}`).toEqual([]);
      }
    }
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

  it("records partial sync outcomes as warnings with a safe summary", async () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const worker = createScheduleSyncWorker({
      fetchImpl: async () => response({
        status: "partial",
        gamesSucceeded: 4,
        gamesFailed: 1,
        snapshotsPersisted: 4,
        errors: [{ game: "lol", code: "PANDASCORE_RATE_LIMITED", httpStatus: 429 }],
      }),
      log,
    });
    const result = await worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret });

    expect(result).toMatchObject({ outcome: "partial", gamesSucceeded: 4, gamesFailed: 1 });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.log).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    const record = JSON.parse(log.warn.mock.calls[0][0]);
    expect(record).toMatchObject({ event: "schedule_sync", outcome: "partial", gamesSucceeded: 4, gamesFailed: 1 });
    expect(record).not.toHaveProperty("errors");
    expect(JSON.stringify(record)).not.toContain(syncSecret);
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
    expect(record).toMatchObject({ code: "ambiguous_sync_failure", httpStatus: null });
    expect(JSON.stringify(record)).not.toContain(syncSecret);
    expect(JSON.stringify(record)).not.toContain("transport");
  });

  it("skips the authenticated sync when the no-store health probe confirms all games are fresh", async () => {
    const requests = [];
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const worker = createScheduleSyncWorker({
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return healthResponse();
      },
      log,
    });

    const result = await worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret });

    expect(result).toEqual({ outcome: "skipped_fresh", snapshotAgeSeconds: 300 });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(healthUrl);
    expect(requests[0].options.headers).toEqual({ accept: "application/json", "cache-control": "no-store" });
    expect(requests[0].options.headers).not.toHaveProperty("authorization");
    expect(log.log).toHaveBeenCalledTimes(1);
    expect(log.log.mock.calls[0][0]).toContain('"outcome":"skipped_fresh"');
  });

  it("requires CRON_SECRET before skipping based on a fresh health response", async () => {
    const fetchImpl = vi.fn(async () => healthResponse());
    const worker = createScheduleSyncWorker({
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      fetchImpl,
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, {}))
      .rejects.toThrow("schedule sync invocation failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["cacheable", "public, max-age=300"],
    ["contradictory", "no-store, s-maxage=300"],
  ])("runs sync rather than trusting a %s health response", async (_description, cacheControl) => {
    const requests = [];
    const worker = createScheduleSyncWorker({
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      fetchImpl: async (url) => {
        requests.push(url);
        return url === healthUrl ? healthResponse({}, 200, cacheControl) : response();
      },
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret }))
      .resolves.toMatchObject({ outcome: "success", generation: 12 });
    expect(requests).toEqual([healthUrl, "https://esports-schedule-two.vercel.app/api/cron/sync"]);
  });

  it("runs the authenticated sync when the health probe reports stale data", async () => {
    const requests = [];
    const worker = createScheduleSyncWorker({
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return url === healthUrl
          ? healthResponse({ stale: true, snapshotAgeSeconds: 901, sourceFetchedAt: "2026-10-18T09:44:59.000Z" })
          : response();
      },
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret }))
      .resolves.toMatchObject({ outcome: "success", generation: 12 });
    expect(requests.map(({ url }) => url)).toEqual([healthUrl, "https://esports-schedule-two.vercel.app/api/cron/sync"]);
    expect(requests[1].options.headers.authorization).toBe(`Bearer ${syncSecret}`);
  });

  it("runs the authenticated sync when the persistent snapshot is fresh but last provider sync is stale", async () => {
    const requests = [];
    const worker = createScheduleSyncWorker({
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      fetchImpl: async (url) => {
        requests.push(url);
        return url === healthUrl
          ? healthResponse({ lastSuccessfulSyncAt: "2026-10-18T09:44:59.000Z" })
          : response();
      },
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret }))
      .resolves.toMatchObject({ outcome: "success", generation: 12 });
    expect(requests).toEqual([healthUrl, "https://esports-schedule-two.vercel.app/api/cron/sync"]);
  });

  it("runs the authenticated sync when freshness timestamps omit a timezone", async () => {
    const requests = [];
    const worker = createScheduleSyncWorker({
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      fetchImpl: async (url) => {
        requests.push(url);
        return url === healthUrl
          ? healthResponse({
              sourceFetchedAt: "2026-10-18T09:55:00",
              lastSuccessfulSyncAt: "2026-10-18T09:55:00",
            })
          : response();
      },
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret }))
      .resolves.toMatchObject({ outcome: "success", generation: 12 });
    expect(requests).toEqual([healthUrl, "https://esports-schedule-two.vercel.app/api/cron/sync"]);
  });

  it("does not accept an invalid calendar date that Date.parse normalizes", async () => {
    const requests = [];
    const worker = createScheduleSyncWorker({
      nowImpl: () => Date.parse("2026-03-02T10:00:00.000Z"),
      fetchImpl: async (url) => {
        requests.push(url);
        return url === healthUrl
          ? healthResponse({
              sourceFetchedAt: "2026-02-30T10:00:00.000Z",
              lastSuccessfulSyncAt: "2026-02-30T10:00:00.000Z",
              snapshotAgeSeconds: 0,
            })
          : response();
      },
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret }))
      .resolves.toMatchObject({ outcome: "success", generation: 12 });
    expect(requests).toEqual([healthUrl, "https://esports-schedule-two.vercel.app/api/cron/sync"]);
  });

  it("does not accept 24:00 timestamps that Date.parse normalizes to the next day", async () => {
    const requests = [];
    const worker = createScheduleSyncWorker({
      nowImpl: () => Date.parse("2026-10-25T00:00:00.000Z"),
      fetchImpl: async (url) => {
        requests.push(url);
        return url === healthUrl
          ? healthResponse({
              sourceFetchedAt: "2026-10-24T24:00:00.000Z",
              lastSuccessfulSyncAt: "2026-10-24T24:00:00.000Z",
              snapshotAgeSeconds: 0,
            })
          : response();
      },
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret }))
      .resolves.toMatchObject({ outcome: "success", generation: 12 });
    expect(requests).toEqual([healthUrl, "https://esports-schedule-two.vercel.app/api/cron/sync"]);
  });

  it("accepts unambiguous ISO timestamps with an explicit non-UTC offset", async () => {
    const requests = [];
    const worker = createScheduleSyncWorker({
      nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
      fetchImpl: async (url) => {
        requests.push(url);
        return url === healthUrl
          ? healthResponse({
              sourceFetchedAt: "2026-10-18T05:55:00.000-04:00",
              lastSuccessfulSyncAt: "2026-10-18T05:55:00.000-04:00",
            })
          : response();
      },
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret }))
      .resolves.toEqual({ outcome: "skipped_fresh", snapshotAgeSeconds: 300 });
    expect(requests).toEqual([healthUrl]);
  });

  it("fails toward sync when health is unavailable or not a trustworthy five-game snapshot", async () => {
    for (const health of [
      healthResponse({}, 503),
      healthResponse({ games: { lol: { syncStatus: "normal" } } }),
      healthResponse({ sourceFetchedAt: "2099-01-01T00:00:00.000Z" }),
      healthResponse({ lastSuccessfulSyncAt: null }),
      healthResponse({ lastSuccessfulSyncAt: "2026-10-18T09:44:59.000Z" }),
      healthResponse({ lastSuccessfulSyncAt: "2099-01-01T00:00:00.000Z" }),
    ]) {
      const requests = [];
      const worker = createScheduleSyncWorker({
        nowImpl: () => Date.parse("2026-10-18T10:00:00.000Z"),
        fetchImpl: async (url) => {
          requests.push(url);
          return url === healthUrl ? health : response();
        },
        log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await expect(worker.scheduled({ scheduledTime: 1, noRetry: vi.fn() }, { CRON_SECRET: syncSecret }))
        .resolves.toMatchObject({ outcome: "success" });
      expect(requests).toEqual([healthUrl, "https://esports-schedule-two.vercel.app/api/cron/sync"]);
    }
  });

  it("uses a strict no-store response policy and a bounded parser", async () => {
    await expect(invokeScheduleSync({
      secret: syncSecret,
      fetchImpl: async () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    })).rejects.toMatchObject({ code: "ambiguous_sync_failure", httpStatus: 200 });

    await expect(invokeScheduleSync({
      secret: syncSecret,
      fetchImpl: async () => new Response("x".repeat(32 * 1024 + 1), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    })).rejects.toMatchObject({ code: "ambiguous_sync_failure", httpStatus: 200 });
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
    })).rejects.toMatchObject({ code: "ambiguous_sync_failure", httpStatus: 200 });

    // ReadableStream may prefetch one additional chunk into its internal queue.
    expect(pullCount).toBeGreaterThan(1_024);
    expect(pullCount).toBeLessThanOrEqual(1_026);
    expect(canceled).toBe(true);
  });
});
