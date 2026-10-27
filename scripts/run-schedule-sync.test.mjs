import { describe, expect, it, vi } from "vitest";
import { runScheduleSync } from "./run-schedule-sync.mjs";

const syncUrl = "https://esports-schedule-two.vercel.app/api/cron/sync";
const healthUrl = "https://esports-schedule-two.vercel.app/api/health/data-coverage";
const secret = "test-only-cron-secret";
const now = Date.parse("2026-10-18T10:00:00.000Z");
const games = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"];

function healthResponse({ lastSuccessfulSyncAt, sourceFetchedAt, stale, ageSeconds }) {
  const perGame = Object.fromEntries(games.map((game) => [game, {
    syncStatus: stale ? "delayed" : "normal",
    sourceFetchedAt,
    lastSuccessfulSyncAt,
  }]));
  return Response.json({
    mode: "live",
    demoMode: false,
    stale,
    refreshInProgress: false,
    providers: { pandascore: "connected" },
    sourceFetchedAt,
    lastSuccessfulSyncAt,
    snapshotAgeSeconds: ageSeconds,
    games: perGame,
  }, { headers: { "cache-control": "no-store, no-cache, must-revalidate" } });
}

function staleHealth() {
  return healthResponse({
    lastSuccessfulSyncAt: "2026-10-18T09:30:00.000Z",
    sourceFetchedAt: "2026-10-18T09:30:00.000Z",
    stale: true,
    ageSeconds: 1_800,
  });
}

function freshHealth() {
  return healthResponse({
    lastSuccessfulSyncAt: "2026-10-18T09:59:30.000Z",
    sourceFetchedAt: "2026-10-18T09:59:30.000Z",
    stale: false,
    ageSeconds: 30,
  });
}

function freshHealthAtAge(ageSeconds) {
  const timestamp = new Date(now - ageSeconds * 1_000).toISOString();
  return healthResponse({
    lastSuccessfulSyncAt: timestamp,
    sourceFetchedAt: timestamp,
    stale: false,
    ageSeconds,
  });
}

function syncSuccess() {
  return Response.json({
    ok: true,
    status: "success",
    lockAcquired: true,
    generation: 42,
    gamesAttempted: 5,
    gamesSucceeded: 5,
    gamesFailed: 0,
    snapshotsPersisted: 5,
    lastSuccessfulSyncAt: "2026-10-18T09:59:30.000Z",
  });
}

function makeOptions(fetchImpl) {
  return {
    secret,
    nowImpl: () => now,
    fetchImpl,
    timeoutSignalImpl: vi.fn(() => new AbortController().signal),
  };
}

describe("runScheduleSync", () => {
  it("performs one authenticated sync and validates its structured result", async () => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url, options) => {
      calls.push({ url, options });
      return url === healthUrl ? staleHealth() : syncSuccess();
    }));

    expect(result).toMatchObject({ ok: true, payload: { generation: 42 } });
    expect(calls.map(({ url }) => url)).toEqual([healthUrl, syncUrl]);
    expect(calls[1].options.headers.authorization).toBe(`Bearer ${secret}`);
    expect(calls[1].url).toBe(syncUrl);
    expect(calls[1].options.signal).toBeDefined();
  });

  it("accepts an ambiguous lost response only after freshness and successful time advance", async () => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) return calls.length === 1 ? staleHealth() : freshHealth();
      throw new TypeError("transport failed after request dispatch");
    }));

    expect(result).toEqual({
      ok: true,
      outcome: "verified_fresh_after_ambiguous_response",
      lastSuccessfulSyncAt: "2026-10-18T09:59:30.000Z",
    });
    expect(calls).toEqual([healthUrl, syncUrl, healthUrl]);
  });

  it("reconciles a 2xx response whose body stream fails after headers arrive", async () => {
    const calls = [];
    const interruptedResponse = new Response(new ReadableStream({
      start(controller) {
        controller.error(new TypeError("connection reset while reading body"));
      },
    }), { status: 200, headers: { "content-type": "application/json" } });

    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) return calls.length === 1 ? staleHealth() : freshHealth();
      return interruptedResponse;
    }));

    expect(result).toMatchObject({
      outcome: "verified_fresh_after_ambiguous_response",
      lastSuccessfulSyncAt: "2026-10-18T09:59:30.000Z",
    });
    expect(calls).toEqual([healthUrl, syncUrl, healthUrl]);
  });

  it("reconciles a 5xx only when health proves a newer fresh five-game snapshot", async () => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) return calls.length === 1 ? staleHealth() : freshHealth();
      return Response.json({ error: "upstream response lost after sync" }, { status: 503 });
    }));

    expect(result).toEqual({
      ok: true,
      outcome: "verified_fresh_after_ambiguous_response",
      lastSuccessfulSyncAt: "2026-10-18T09:59:30.000Z",
    });
    expect(calls).toEqual([healthUrl, syncUrl, healthUrl]);
  });

  it("fails a 5xx when the post-request health snapshot is not fresh and advanced", async () => {
    const calls = [];
    await expect(runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) return staleHealth();
      return Response.json({ error: "sync failed" }, { status: 503 });
    }))).rejects.toMatchObject({ code: "sync_http_failure_without_verified_refresh" });

    expect(calls).toEqual([healthUrl, syncUrl, healthUrl]);
  });

  it("reconciles an unreadable 5xx only when health proves a newer fresh snapshot", async () => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) return calls.length === 1 ? staleHealth() : freshHealth();
      return new Response("upstream gateway error", {
        status: 502,
        headers: { "content-type": "text/html" },
      });
    }));

    expect(result).toEqual({
      ok: true,
      outcome: "verified_fresh_after_ambiguous_response",
      lastSuccessfulSyncAt: "2026-10-18T09:59:30.000Z",
    });
    expect(calls).toEqual([healthUrl, syncUrl, healthUrl]);
  });

  it("does not accept a globally fresh snapshot when one game's timestamps are stale", async () => {
    const calls = [];
    await expect(runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl && calls.length === 1) return staleHealth();
      if (url === syncUrl) return Response.json({ error: "ambiguous" }, { status: 503 });
      const payload = await freshHealth().json();
      payload.games.cs2.sourceFetchedAt = "2026-10-18T09:30:00.000Z";
      return Response.json(payload, {
        headers: { "cache-control": "no-store, no-cache, must-revalidate" },
      });
    }))).rejects.toMatchObject({ code: "sync_http_failure_without_verified_refresh" });

    expect(calls).toEqual([healthUrl, syncUrl, healthUrl]);
  });

  it("caps response parsing work even when a body emits endless empty chunks", async () => {
    const calls = [];
    let pulls = 0;
    const emptyChunkStream = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array());
      },
    });

    await expect(runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) return staleHealth();
      return new Response(emptyChunkStream, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }))).rejects.toMatchObject({ code: "sync_response_unreadable" });

    expect(pulls).toBeLessThanOrEqual(1_026);
    expect(calls).toEqual([healthUrl, syncUrl, healthUrl]);
  });

  it("fails an ambiguous response when the health snapshot did not advance", async () => {
    const calls = [];
    await expect(runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) return staleHealth();
      throw new TypeError("transport failed");
    }))).rejects.toMatchObject({ code: "sync_transport_failed_without_verified_refresh" });

    expect(calls).toEqual([healthUrl, syncUrl, healthUrl]);
  });

  it("confirms a concurrent refresh after busy only if its snapshot is newer and fresh", async () => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) return calls.length === 1 ? staleHealth() : freshHealth();
      return Response.json({
        ok: false,
        status: "busy",
        lockAcquired: false,
        generation: null,
      }, { status: 409 });
    }));

    expect(result).toMatchObject({
      ok: true,
      outcome: "verified_fresh_after_concurrent_sync",
      lastSuccessfulSyncAt: "2026-10-18T09:59:30.000Z",
    });
    expect(calls).toEqual([healthUrl, syncUrl, healthUrl]);
  });

  it("fails busy when no newer fresh snapshot can be verified", async () => {
    const calls = [];
    await expect(runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) return staleHealth();
      return Response.json({
        ok: false,
        status: "busy",
        lockAcquired: false,
        generation: null,
      }, { status: 409 });
    }))).rejects.toMatchObject({ code: "sync_busy_without_verified_refresh" });

    expect(calls).toEqual([healthUrl, syncUrl, healthUrl]);
  });

  it("skips the sync request when preflight confirms all five game snapshots are fresh", async () => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      return freshHealth();
    }));

    expect(result).toEqual({
      ok: true,
      outcome: "already_fresh",
      lastSuccessfulSyncAt: "2026-10-18T09:59:30.000Z",
    });
    expect(calls).toEqual([healthUrl]);
  });

  it("skips at the 10-minute guard-band boundary", async () => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      return freshHealthAtAge(10 * 60);
    }));

    expect(result).toMatchObject({ ok: true, outcome: "already_fresh" });
    expect(calls).toEqual([healthUrl]);
  });

  it.each([
    ["+14:01", "2026-10-19T00:00:30+14:01"],
    ["+15:00", "2026-10-19T00:59:30+15:00"],
    ["-14:01", "2026-10-18T19:58:30-14:01"],
    ["+23:59", "2026-10-19T09:58:30+23:59"],
    ["-00:00", "2026-10-18T09:59:30-00:00"],
  ])("does not treat an out-of-range ISO offset (%s) as a fresh snapshot", async (_offset, timestamp) => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      return url === healthUrl
        ? healthResponse({
          lastSuccessfulSyncAt: timestamp,
          sourceFetchedAt: timestamp,
          stale: false,
          ageSeconds: 30,
        })
        : syncSuccess();
    }));

    expect(result).toMatchObject({ ok: true, payload: { generation: 42 } });
    expect(calls).toEqual([healthUrl, syncUrl]);
  });

  it.each([
    ["+14:00", "2026-10-18T23:59:30+14:00"],
    ["-14:00", "2026-10-17T19:59:30-14:00"],
  ])("accepts the ISO offset boundary (%s) when the instant is fresh", async (_offset, timestamp) => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      return healthResponse({
        lastSuccessfulSyncAt: timestamp,
        sourceFetchedAt: timestamp,
        stale: false,
        ageSeconds: 30,
      });
    }));

    expect(result).toMatchObject({ ok: true, outcome: "already_fresh" });
    expect(calls).toEqual([healthUrl]);
  });

  it("refreshes once the snapshot enters the five-minute pre-expiry guard band", async () => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      return url === healthUrl ? freshHealthAtAge(10 * 60 + 1) : syncSuccess();
    }));

    expect(result).toMatchObject({ ok: true, payload: { generation: 42 } });
    expect(calls).toEqual([healthUrl, syncUrl]);
  });

  it("forces synchronization for an explicit manual dispatch despite a fresh preflight", async () => {
    const calls = [];
    const result = await runScheduleSync({
      ...makeOptions(async (url) => {
        calls.push(url);
        return url === healthUrl ? freshHealth() : syncSuccess();
      }),
      force: true,
    });

    expect(result).toMatchObject({ ok: true, payload: { generation: 42 } });
    expect(calls).toEqual([healthUrl, syncUrl]);
  });

  it("does not skip when one game's timestamp is stale despite fresh aggregate health", async () => {
    const calls = [];
    const result = await runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) {
        const payload = await freshHealth().json();
        const staleAt = "2026-10-18T09:30:00.000Z";
        payload.games.cs2.sourceFetchedAt = staleAt;
        payload.games.cs2.lastSuccessfulSyncAt = staleAt;
        return Response.json(payload, {
          headers: { "cache-control": "no-store, no-cache, must-revalidate" },
        });
      }
      return syncSuccess();
    }));

    expect(result).toMatchObject({ ok: true, payload: { generation: 42 } });
    expect(calls).toEqual([healthUrl, syncUrl]);
  });

  it("keeps concurrent stale preflights behind the sync lock without treating busy as a refresh", async () => {
    const calls = [];
    let healthCalls = 0;
    let syncCalls = 0;
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url === healthUrl) {
        healthCalls += 1;
        return healthCalls <= 2 ? staleHealth() : freshHealth();
      }
      syncCalls += 1;
      if (syncCalls === 1) return syncSuccess();
      return Response.json({
        ok: false,
        status: "busy",
        lockAcquired: false,
        generation: null,
      }, { status: 409 });
    };

    const results = await Promise.all([
      runScheduleSync(makeOptions(fetchImpl)),
      runScheduleSync(makeOptions(fetchImpl)),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "success: 5 games updated, 0 failed",
      "verified_fresh_after_concurrent_sync",
    ]);
    expect(calls.filter((url) => url === syncUrl)).toHaveLength(2);
    expect(healthCalls).toBe(3);
  });

  it("fails closed when the baseline health probe is unavailable and the sync response is ambiguous", async () => {
    const calls = [];
    await expect(runScheduleSync(makeOptions(async (url) => {
      calls.push(url);
      if (url === healthUrl) throw new TypeError("health unavailable");
      throw new TypeError("sync response lost");
    }))).rejects.toMatchObject({ code: "sync_transport_failed_without_verified_refresh" });

    expect(calls).toEqual([healthUrl, syncUrl]);
  });
});
