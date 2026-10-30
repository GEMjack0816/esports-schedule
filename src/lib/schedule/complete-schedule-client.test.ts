import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPLETE_SCHEDULE_TIMEOUT_MS, fetchCompleteSchedulePayload } from "./complete-schedule-client";
import type { SchedulePayload } from "./types";

const payload = {
  matches: [],
  coverage: { totals: { finalWithManual: 0 } },
} as unknown as SchedulePayload;

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchCompleteSchedulePayload", () => {
  it("aborts a request that never returns headers and rejects at the deadline", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });

    const result = fetchCompleteSchedulePayload(fetchImpl);
    const assertion = expect(result).rejects.toThrow("schedule_request_timeout");
    await vi.advanceTimersByTimeAsync(COMPLETE_SCHEDULE_TIMEOUT_MS);
    await assertion;

    expect(requestSignal?.aborted).toBe(true);
  });

  it("keeps the same deadline active while parsing a stalled response body", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return Promise.resolve({
        ok: true,
        json: () => new Promise<SchedulePayload>((_, reject) => {
          requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
      } as Response);
    });

    const result = fetchCompleteSchedulePayload(fetchImpl);
    const assertion = expect(result).rejects.toThrow("schedule_request_timeout");
    await vi.advanceTimersByTimeAsync(COMPLETE_SCHEDULE_TIMEOUT_MS);
    await assertion;

    expect(requestSignal?.aborted).toBe(true);
  });

  it("returns a complete payload and requests it without caching", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      json: async () => payload,
      init,
    } as unknown as Response));

    await expect(fetchCompleteSchedulePayload(fetchImpl)).resolves.toBe(payload);
    expect(fetchImpl).toHaveBeenCalledWith("/api/matches", expect.objectContaining({
      cache: "no-store",
      signal: expect.any(AbortSignal),
    }));
  });

  it("rejects incomplete and unsuccessful responses with stable errors", async () => {
    await expect(fetchCompleteSchedulePayload(async () => ({
      ok: true,
      json: async () => ({ matches: [], coverage: { totals: { finalWithManual: 1 } } }),
    } as unknown as Response))).rejects.toThrow("incomplete_schedule_response");
    await expect(fetchCompleteSchedulePayload(async () => ({ ok: false } as unknown as Response)))
      .rejects.toThrow("schedule_request_failed");
  });
});
