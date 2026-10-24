export const SCHEDULE_REFRESH_TIMEOUT_MS = 15_000;

export class ScheduleRefreshTimeoutError extends Error {
  constructor() {
    super("Schedule refresh timed out");
    this.name = "ScheduleRefreshTimeoutError";
  }
}

export function getScheduleRefreshErrorMessage(error: unknown): string {
  return error instanceof ScheduleRefreshTimeoutError
    ? "重新获取赛程超时，已保留当前赛程，请稍后重试。"
    : "暂时无法重新获取赛程，请检查网络后重试。";
}

/** Fetch an updated schedule with a finite deadline so the UI can recover from a stalled request. */
export async function fetchScheduleRefresh(
  fetcher: typeof fetch = fetch,
  timeoutMs = SCHEDULE_REFRESH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetcher("/api/matches", { cache: "no-store", signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new ScheduleRefreshTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
