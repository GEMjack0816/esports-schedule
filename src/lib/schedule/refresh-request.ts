export const SCHEDULE_REFRESH_TIMEOUT_MS = 15_000;
const REFRESH_STATUS_POLL_INTERVAL_MS = 1_000;

export type ScheduleRefreshResult = {
  response: Response;
  backgroundRefresh: "none" | "started" | "completed";
};

export class ScheduleRefreshTimeoutError extends Error {
  constructor() {
    super("Schedule refresh timed out");
    this.name = "ScheduleRefreshTimeoutError";
  }
}

export function getScheduleRefreshErrorMessage(error: unknown): string {
  return error instanceof ScheduleRefreshTimeoutError
    ? "后台赛程检查仍在进行或暂不可确认，已保留当前页面；请稍后重试。"
    : "暂时无法重新获取赛程，请检查网络后重试。";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyUnavailableSchedule(payload: unknown): payload is Record<string, unknown> {
  return isRecord(payload)
    && payload.mode === "unavailable"
    && Array.isArray(payload.matches)
    && payload.matches.length === 0;
}

type RefreshProbe = {
  mode: "live" | "unavailable";
  stale: boolean;
  refreshInProgress: boolean;
  lastAttemptAt: string | null;
  sourceFetchedAt: string | null;
};

function readRefreshProbe(value: unknown): RefreshProbe | null {
  if (!isRecord(value)
    || (value.mode !== "live" && value.mode !== "unavailable")
    || typeof value.stale !== "boolean"
    || typeof value.refreshInProgress !== "boolean"
    || !(typeof value.lastAttemptAt === "string" || value.lastAttemptAt === null)
    || !(typeof value.sourceFetchedAt === "string" || value.sourceFetchedAt === null)) {
    return null;
  }

  return {
    mode: value.mode,
    stale: value.stale,
    refreshInProgress: value.refreshInProgress,
    lastAttemptAt: value.lastAttemptAt,
    sourceFetchedAt: value.sourceFetchedAt,
  };
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, REFRESH_STATUS_POLL_INTERVAL_MS);

    function onAbort() {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Read the immediate cached response first. Only an explicit background-refresh
 * signal plus a missing first snapshot waits briefly for that work to settle;
 * normal stale-while-refresh requests stay non-blocking.
 */
export async function fetchScheduleRefresh(
  fetcher: typeof fetch = fetch,
  timeoutMs = SCHEDULE_REFRESH_TIMEOUT_MS,
): Promise<ScheduleRefreshResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const initialResponse = await fetcher("/api/matches", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!initialResponse.ok
      || initialResponse.headers.get("x-schedule-refresh-scheduled") !== "true") {
      return { response: initialResponse, backgroundRefresh: "none" };
    }

    let initialPayload: unknown;
    try {
      initialPayload = await initialResponse.clone().json();
    } catch {
      return { response: initialResponse, backgroundRefresh: "started" };
    }

    if (!isEmptyUnavailableSchedule(initialPayload)) {
      return { response: initialResponse, backgroundRefresh: "started" };
    }

    const initialProbe = isRecord(initialPayload) && isRecord(initialPayload.coverage)
      ? readRefreshProbe({
        ...initialPayload.coverage,
        mode: initialPayload.mode,
        stale: initialPayload.stale,
      })
      : null;
    if (!initialProbe) {
      return { response: initialResponse, backgroundRefresh: "started" };
    }

    let observedRefreshInProgress = initialProbe.refreshInProgress;
    for (;;) {
      await waitForPoll(controller.signal);
      const healthResponse = await fetcher("/api/health/data-coverage", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!healthResponse.ok) continue;

      let healthPayload: unknown;
      try {
        healthPayload = await healthResponse.json();
      } catch {
        continue;
      }

      const probe = readRefreshProbe(healthPayload);
      if (!probe) continue;
      if (probe.refreshInProgress) observedRefreshInProgress = true;

      const attemptChanged = probe.lastAttemptAt !== initialProbe.lastAttemptAt;
      const sourceChanged = probe.sourceFetchedAt !== initialProbe.sourceFetchedAt;
      const refreshSettled = !probe.refreshInProgress
        && (observedRefreshInProgress || attemptChanged || sourceChanged);
      const healthySnapshot = probe.mode === "live" && !probe.stale;

      if (healthySnapshot) {
        const refreshedResponse = await fetcher("/api/matches", {
          cache: "no-store",
          signal: controller.signal,
        });
        return { response: refreshedResponse, backgroundRefresh: "completed" };
      }

      if (refreshSettled) {
        return { response: initialResponse, backgroundRefresh: "completed" };
      }
    }
  } catch (error) {
    if (timedOut) throw new ScheduleRefreshTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
