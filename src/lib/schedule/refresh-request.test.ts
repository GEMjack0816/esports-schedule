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

    await expect(fetchScheduleRefresh(fetcher)).resolves.toBe(response);
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
      .toBe("重新获取赛程超时，已保留当前赛程，请稍后重试。");
    expect(getScheduleRefreshErrorMessage(new TypeError("internal transport detail")))
      .toBe("暂时无法重新获取赛程，请检查网络后重试。");
  });
});
