import { afterEach, describe, expect, it, vi } from "vitest";
import { requestScheduleRefresh, SCHEDULE_REFRESH_TIMEOUT_MS } from "./client-refresh";

afterEach(() => vi.useRealTimers());

describe("schedule refresh transport", () => {
  it("reads the same-origin endpoint without cache and returns its JSON", async () => {
    const payload = { matches: [], mode: "unavailable" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    expect(await requestScheduleRefresh(fetcher)).toEqual({ ok: true, payload });
    expect(fetcher).toHaveBeenCalledWith("/api/matches", {
      cache: "no-store", signal: expect.any(AbortSignal),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
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
  it("clears the deadline immediately after success", async () => {
    vi.useFakeTimers();
    await requestScheduleRefresh(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ matches: [] })));
    expect(vi.getTimerCount()).toBe(0);
  });
});
