import type { SchedulePayload } from "./types";

export const COMPLETE_SCHEDULE_TIMEOUT_MS = 15_000;

/** Load the deferred full payload with a deadline covering headers and body parsing. */
export async function fetchCompleteSchedulePayload(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = COMPLETE_SCHEDULE_TIMEOUT_MS,
): Promise<SchedulePayload> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("schedule_request_timeout"));
    }, timeoutMs);
  });

  const request = (async () => {
    const response = await fetchImpl("/api/matches", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("schedule_request_failed");

    const payload = await response.json() as SchedulePayload;
    if (!Array.isArray(payload.matches)
      || !Number.isInteger(payload.coverage?.totals?.finalWithManual)
      || payload.matches.length !== payload.coverage.totals.finalWithManual) {
      throw new Error("incomplete_schedule_response");
    }
    return payload;
  })();

  try {
    return await Promise.race([request, timeout]);
  } catch (error) {
    // Keep internal failures stable and safe for the UI; callers only need retry semantics.
    if (timedOut) throw new Error("schedule_request_timeout");
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
