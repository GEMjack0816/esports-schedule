import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchScheduleRefresh,
  getScheduleRefreshErrorMessage,
  SCHEDULE_REFRESH_TIMEOUT_MS,
  ScheduleRefreshTimeoutError,
} from "./refresh-request";

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchScheduleRefresh", () => {
  it("aborts a stalled request at the deadline and reports a timeout", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }) as typeof fetch;

    const request = fetchScheduleRefresh(fetcher);
    const rejection = expect(request).rejects.toBeInstanceOf(ScheduleRefreshTimeoutError);
    await vi.advanceTimersByTimeAsync(SCHEDULE_REFRESH_TIMEOUT_MS);
    await rejection;

    expect(requestSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("clears the deadline after a successful response", async () => {
    vi.useFakeTimers();
    const response = new Response("{}", { status: 200 });
    const fetcher = vi.fn(async () => response) as typeof fetch;

    await expect(fetchScheduleRefresh(fetcher)).resolves.toEqual({
      response,
      backgroundRefresh: "none",
    });
    await vi.advanceTimersByTimeAsync(SCHEDULE_REFRESH_TIMEOUT_MS);

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("preserves ordinary network errors instead of labeling them as timeouts", async () => {
    const failure = new TypeError("network unavailable");
    const fetcher = vi.fn(async () => { throw failure; }) as typeof fetch;

    await expect(fetchScheduleRefresh(fetcher)).rejects.toBe(failure);
  });

  it("shows a safe timeout message and keeps a separate network-failure message", () => {
    expect(getScheduleRefreshErrorMessage(new ScheduleRefreshTimeoutError()))
      .toBe("后台赛程检查仍在进行或暂不可确认，已保留当前页面；请稍后重试。");
    expect(getScheduleRefreshErrorMessage(new TypeError("internal transport detail")))
      .toBe("暂时无法重新获取赛程，请检查网络后重试。");
  });

  it("waits for the background first-snapshot refresh and returns the updated schedule", async () => {
    vi.useFakeTimers();
    const initialResponse = new Response(JSON.stringify({
      mode: "unavailable",
      stale: true,
      matches: [],
      coverage: {
        refreshInProgress: false,
        lastAttemptAt: null,
        sourceFetchedAt: null,
      },
    }), {
      status: 200,
      headers: { "x-schedule-refresh-scheduled": "true" },
    });
    const refreshStarted = new Response(JSON.stringify({
      mode: "unavailable",
      stale: true,
      refreshInProgress: true,
      lastAttemptAt: "2026-10-25T10:00:01.000Z",
      sourceFetchedAt: null,
    }));
    const refreshCompleted = new Response(JSON.stringify({
      mode: "live",
      stale: false,
      refreshInProgress: false,
      lastAttemptAt: "2026-10-25T10:00:01.000Z",
      sourceFetchedAt: "2026-10-25T10:00:03.000Z",
    }));
    const updatedResponse = new Response(JSON.stringify({ mode: "live", matches: [{ id: "match-1" }] }));
    const fetcherMock = vi.fn()
      .mockResolvedValueOnce(initialResponse)
      .mockResolvedValueOnce(refreshStarted)
      .mockResolvedValueOnce(refreshCompleted)
      .mockResolvedValueOnce(updatedResponse);
    const fetcher = fetcherMock as unknown as typeof fetch;

    const request = fetchScheduleRefresh(fetcher);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(request).resolves.toEqual({
      response: updatedResponse,
      backgroundRefresh: "completed",
    });
    expect(fetcherMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/matches",
      "/api/health/data-coverage",
      "/api/health/data-coverage",
      "/api/matches",
    ]);
  });

  it("does not refetch after a completed attempt still has no real snapshot", async () => {
    vi.useFakeTimers();
    const initialResponse = new Response(JSON.stringify({
      mode: "unavailable",
      stale: true,
      matches: [],
      coverage: {
        refreshInProgress: false,
        lastAttemptAt: null,
        sourceFetchedAt: null,
      },
    }), {
      status: 200,
      headers: { "x-schedule-refresh-scheduled": "true" },
    });
    const failedRefresh = new Response(JSON.stringify({
      mode: "unavailable",
      stale: true,
      refreshInProgress: false,
      lastAttemptAt: "2026-10-25T10:00:01.000Z",
      sourceFetchedAt: null,
    }));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(initialResponse)
      .mockResolvedValueOnce(failedRefresh) as unknown as typeof fetch;

    const request = fetchScheduleRefresh(fetcher);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(request).resolves.toEqual({
      response: initialResponse,
      backgroundRefresh: "completed",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not poll when a scheduled background refresh already has a usable snapshot", async () => {
    const staleResponse = new Response(JSON.stringify({ mode: "live", matches: [{ id: "old" }] }), {
      status: 200,
      headers: { "x-schedule-refresh-scheduled": "true" },
    });
    const fetcher = vi.fn(async () => staleResponse) as typeof fetch;

    await expect(fetchScheduleRefresh(fetcher)).resolves.toEqual({
      response: staleResponse,
      backgroundRefresh: "started",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("bounds first-snapshot polling by the same refresh deadline", async () => {
    vi.useFakeTimers();
    const initialResponse = new Response(JSON.stringify({
      mode: "unavailable",
      stale: true,
      matches: [],
      coverage: {
        refreshInProgress: false,
        lastAttemptAt: null,
        sourceFetchedAt: null,
      },
    }), {
      status: 200,
      headers: { "x-schedule-refresh-scheduled": "true" },
    });
    const inProgressResponse = new Response(JSON.stringify({
      mode: "unavailable",
      stale: true,
      refreshInProgress: true,
      lastAttemptAt: "2026-10-25T10:00:01.000Z",
      sourceFetchedAt: null,
    }));
    const fetcherMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/matches" ? initialResponse : inProgressResponse);
    const fetcher = fetcherMock as unknown as typeof fetch;

    const request = fetchScheduleRefresh(fetcher);
    const rejection = expect(request).rejects.toBeInstanceOf(ScheduleRefreshTimeoutError);
    await vi.advanceTimersByTimeAsync(SCHEDULE_REFRESH_TIMEOUT_MS);
    await rejection;

    expect(fetcherMock.mock.calls.filter(([input]) => String(input) === "/api/health/data-coverage").length)
      .toBeGreaterThan(0);
    expect(fetcherMock.mock.calls.filter(([input]) => String(input) === "/api/health/data-coverage").length)
      .toBeLessThan(SCHEDULE_REFRESH_TIMEOUT_MS / 1_000);
  });
});
