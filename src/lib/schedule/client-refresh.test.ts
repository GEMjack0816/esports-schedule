import { afterEach, describe, expect, it, vi } from "vitest";
import type { SchedulePayload } from "./types";
import {
  canReplaceSchedulePayload,
  requestScheduleRefresh,
  SCHEDULE_REFRESH_TIMEOUT_MS,
} from "./client-refresh";

afterEach(() => vi.useRealTimers());

describe("schedule refresh transport", () => {
  const gameCoverage = {
    syncGeneration: 10,
    syncStatus: "normal",
    refreshInProgress: false,
    sourceFetchedAt: "2026-08-30T00:00:00.000Z",
  };
  const payload = {
    matches: [{
      id: "pandascore:lol:1",
      provider: "pandascore",
      providerMatchId: "1",
      game: "lol",
      tournament: null,
      league: "Refresh test",
      stage: null,
      homeTeam: { name: "Alpha", logo: "/team-placeholder.svg" },
      awayTeam: { name: "Beta", logo: "/team-placeholder.svg" },
      homeScore: null,
      awayScore: null,
      bestOf: 3,
      status: "scheduled",
      startTimeUtc: "2026-08-31T00:00:00.000Z",
      streams: [{ label: "Official", url: "https://example.com/live" }],
      lastUpdatedAt: "2026-08-30T00:00:00.000Z",
    }],
    generatedAt: "2026-08-30T00:00:00.000Z",
    mode: "live",
    demoMode: false,
    stale: false,
    lastSuccessfulSyncAt: "2026-08-30T00:00:00.000Z",
    providers: { pandascore: "connected", manual: "json+database" },
    coverage: {
      sourceFetchedAt: "2026-08-30T00:00:00.000Z",
      lastAttemptAt: "2026-08-30T00:00:00.000Z",
      refreshInProgress: false,
      range: {
        earliestMatchAt: "2026-08-31T00:00:00.000Z",
        latestMatchAt: "2026-08-31T00:00:00.000Z",
      },
      games: Object.fromEntries([
        "lol", "valorant", "honor-of-kings", "cs2", "dota2",
      ].map((game) => [game, gameCoverage])),
    },
    deployment: { id: null, commitSha: null, productionUrl: null, environment: "preview" },
  } as SchedulePayload;

  it("reads the same-origin endpoint without cache and returns its JSON", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    expect(await requestScheduleRefresh(fetcher)).toEqual({ ok: true, payload });
    expect(fetcher).toHaveBeenCalledWith("/api/matches", {
      cache: "no-store", signal: expect.any(AbortSignal),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("waits for a newer per-game generation using cache-only reads", async () => {
    const baseline = payload;
    const updated = {
      ...payload,
      coverage: {
        ...payload.coverage,
        games: {
          ...payload.coverage.games,
          lol: { ...payload.coverage.games.lol, syncGeneration: 11 },
        },
      },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(baseline, {
        headers: { "x-schedule-refresh-scheduled": "true" },
      }))
      .mockResolvedValueOnce(Response.json({
        ...baseline,
        coverage: {
          ...baseline.coverage,
          refreshInProgress: true,
          lastAttemptAt: "2026-08-30T00:00:02.000Z",
        },
      }))
      .mockResolvedValueOnce(Response.json(updated));

    expect(await requestScheduleRefresh(fetcher, { pollIntervalMs: 0 }, baseline))
      .toEqual({ ok: true, payload: updated });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/matches",
      "/api/matches?snapshotOnly=1",
      "/api/matches?snapshotOnly=1",
    ]);
  });
  it("fails closed when the completed refresh leaves cache-only reads on the old generation", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload, {
        headers: { "x-schedule-refresh-scheduled": "true" },
      }))
      .mockResolvedValueOnce(Response.json({
        ...payload,
        coverage: {
          ...payload.coverage,
          refreshInProgress: false,
          lastAttemptAt: "2026-08-30T00:00:02.000Z",
        },
      }));

    expect(await requestScheduleRefresh(fetcher, {}, payload)).toEqual({ ok: false });
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/matches?snapshotOnly=1");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retries a transient cache-only request failure within the bounded refresh window", async () => {
    const advancedProbe = {
      ...payload.coverage,
      lastAttemptAt: "2026-08-30T00:00:02.000Z",
      games: {
        ...payload.coverage.games,
        lol: { ...payload.coverage.games.lol, syncGeneration: 11 },
      },
    };
    const updated = {
      ...payload,
      coverage: { ...payload.coverage, games: advancedProbe.games },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload, {
        headers: { "x-schedule-refresh-scheduled": "true" },
      }))
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(Response.json(updated));

    expect(await requestScheduleRefresh(fetcher, { pollIntervalMs: 0 }, payload))
      .toEqual({ ok: true, payload: updated });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/matches",
      "/api/matches?snapshotOnly=1",
      "/api/matches?snapshotOnly=1",
    ]);
  });
  it("bounds refresh completion polling and clears abort timers", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload, {
        headers: { "x-schedule-refresh-scheduled": "true" },
      }))
      .mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));

    const result = requestScheduleRefresh(fetcher, {
      pollIntervalMs: 0,
      completionTimeoutMs: 100,
    }, payload);
    await vi.advanceTimersByTimeAsync(100);

    expect(await result).toEqual({ ok: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([401, 429, 500, 503])("does not expose or accept HTTP %i response bodies", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private upstream details", { status }));
    expect(await requestScheduleRefresh(fetcher)).toEqual({ ok: false });
  });
  it("handles network rejection without returning exception details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private transport details"));
    expect(await requestScheduleRefresh(fetcher)).toEqual({ ok: false });
  });
  it("handles invalid JSON without replacing the prior data", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>failure</html>"));
    expect(await requestScheduleRefresh(fetcher)).toEqual({ ok: false });
  });
  it("rejects valid-looking payloads served with a JSON-like but invalid media type", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload, {
      headers: { "Content-Type": "application/jsonp" },
    }));
    expect(await requestScheduleRefresh(fetcher)).toEqual({ ok: false });
  });
  it("accepts application/json with a charset parameter", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload, {
      headers: { "Content-Type": "Application/JSON; charset=utf-8" },
    }));
    expect(await requestScheduleRefresh(fetcher)).toEqual({ ok: true, payload });
  });
  it.each([
    {},
    { ...payload, matches: null },
    { ...payload, matches: [{ ...payload.matches[0], game: "unknown-game" }] },
    { ...payload, matches: [{ ...payload.matches[0], status: "live-ish" }] },
    { ...payload, matches: [{ ...payload.matches[0], homeTeam: null }] },
    { ...payload, matches: [{ ...payload.matches[0], streams: [{ label: "bad", url: "javascript:alert(1)" }] }] },
    { ...payload, coverage: { ...payload.coverage, games: {} } },
    { ...payload, coverage: { ...payload.coverage, games: Object.fromEntries(
      Object.entries(payload.coverage.games).map(([game, value]) => [game, { ...value, syncGeneration: 0 }]),
    ) } },
  ])("rejects render-unsafe successful JSON without replacing prior data", async unsafePayload => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(unsafePayload));
    expect(await requestScheduleRefresh(fetcher)).toEqual({ ok: false });
  });
  it("aborts a stalled request and releases its deadline timer", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const result = requestScheduleRefresh(fetcher);
    await vi.advanceTimersByTimeAsync(SCHEDULE_REFRESH_TIMEOUT_MS);
    expect(await result).toEqual({ ok: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a stalled response body and releases its deadline timer", async () => {
    vi.useFakeTimers();
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
          controller.enqueue(new TextEncoder().encode("{"));
        },
      });
      init?.signal?.addEventListener("abort", () => bodyController?.error(new Error("aborted")), { once: true });
      return Promise.resolve(new Response(body, { headers: { "Content-Type": "application/json" } }));
    });

    const result = requestScheduleRefresh(fetcher);
    await vi.advanceTimersByTimeAsync(SCHEDULE_REFRESH_TIMEOUT_MS);

    expect(await result).toEqual({ ok: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears the deadline immediately after success", async () => {
    vi.useFakeTimers();
    await requestScheduleRefresh(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ matches: [] })));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains a live schedule when the endpoint has no usable snapshot", () => {
    expect(canReplaceSchedulePayload("live", "unavailable")).toBe(false);
    expect(canReplaceSchedulePayload("live", "live")).toBe(true);
  });

  it("rejects a live response whose per-game snapshot generation regresses", () => {
    expect(canReplaceSchedulePayload(
      "live",
      "live",
      { lol: { syncGeneration: 12 } },
      { lol: { syncGeneration: 11 } },
    )).toBe(false);
  });

  it("accepts equal or newer generations and ignores games without a current snapshot", () => {
    expect(canReplaceSchedulePayload(
      "live",
      "live",
      { lol: { syncGeneration: 12 }, cs2: { syncGeneration: null } },
      { lol: { syncGeneration: 12 }, cs2: { syncGeneration: 3 } },
    )).toBe(true);
    expect(canReplaceSchedulePayload(
      "live",
      "live",
      { lol: { syncGeneration: 12 } },
      { lol: { syncGeneration: 13 } },
    )).toBe(true);
  });

  it("fails closed when a previously versioned game loses its generation", () => {
    expect(canReplaceSchedulePayload(
      "live",
      "live",
      { lol: { syncGeneration: 12 } },
      { lol: { syncGeneration: null } },
    )).toBe(false);
  });

  it("allows an unavailable page to receive a later usable schedule", () => {
    expect(canReplaceSchedulePayload("unavailable", "live")).toBe(true);
    expect(canReplaceSchedulePayload("unavailable", "unavailable")).toBe(true);
  });
});
