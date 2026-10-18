const SYNC_URL = "https://esports-schedule-two.vercel.app/api/cron/sync";
const MAX_BODY_BYTES = 32 * 1024;
// A byte limit alone does not bound streams that yield arbitrarily many empty
// or tiny chunks. Cap parser work and per-chunk bookkeeping as well.
const MAX_BODY_CHUNKS = 1_024;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1_000];
const REQUEST_TIMEOUT_MS = 300_000;
// Cloudflare Cron invocations have a 15-minute wall-time ceiling. Keep an
// explicit total budget below it so retries cannot be cut off by the platform.
const INVOCATION_BUDGET_MS = 14 * 60_000;

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class SyncInvocationError extends Error {
  constructor(code, httpStatus = null) {
    super(code);
    this.name = "SyncInvocationError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function cancelReaderWithoutBlocking(reader) {
  try {
    // Some stream implementations may never settle cancellation. The caller
    // must fail immediately once its parsing budget is exceeded.
    void reader.cancel().catch(() => {});
  } catch {
    // Cancellation is best-effort; preserve the bounded parser failure.
  }
}

function retryDelayFor(response, attempt, now) {
  // 429 rate limits and 503 service-unavailable responses may both ask the
  // client to wait; respect that signal before applying the bounded fallback.
  if (response.status !== 429 && response.status !== 503) return RETRY_DELAYS_MS[attempt];

  const retryAfter = response.headers.get("retry-after")?.trim();
  if (!retryAfter) return RETRY_DELAYS_MS[attempt];

  if (/^\d+$/.test(retryAfter)) {
    const seconds = Number(retryAfter);
    return Number.isSafeInteger(seconds) ? seconds * 1_000 : Number.POSITIVE_INFINITY;
  }

  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt)
    ? Math.max(0, retryAt - now)
    : RETRY_DELAYS_MS[attempt];
}

async function readJsonBody(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new SyncInvocationError("invalid_content_type", response.status);
  }
  if (!response.body) throw new SyncInvocationError("missing_response_body", response.status);

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  let chunkCount = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount += 1;
      if (chunkCount > MAX_BODY_CHUNKS) {
        cancelReaderWithoutBlocking(reader);
        throw new SyncInvocationError("response_too_many_chunks", response.status);
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        cancelReaderWithoutBlocking(reader);
        throw new SyncInvocationError("response_too_large", response.status);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SyncInvocationError) throw error;
    throw new SyncInvocationError("invalid_json", response.status);
  }
}

function validateSyncPayload(payload, httpStatus) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SyncInvocationError("invalid_payload", httpStatus);
  }

  if (httpStatus === 409 && payload.status === "busy" && payload.lockAcquired === false) {
    if (payload.generation !== null && payload.generation !== undefined) {
      throw new SyncInvocationError("invalid_busy_response", httpStatus);
    }
    return { outcome: "skipped_busy", generation: null };
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    throw new SyncInvocationError("http_failure", httpStatus);
  }
  if (payload.ok !== true || payload.lockAcquired !== true) {
    throw new SyncInvocationError("sync_not_acquired", httpStatus);
  }
  if (!Number.isSafeInteger(payload.generation) || payload.generation < 1) {
    throw new SyncInvocationError("invalid_generation", httpStatus);
  }
  if (!Number.isInteger(payload.gamesAttempted) || payload.gamesAttempted < 1
    || !Number.isInteger(payload.gamesSucceeded) || payload.gamesSucceeded < 1
    || !Number.isInteger(payload.gamesFailed) || payload.gamesFailed < 0
    || payload.gamesSucceeded + payload.gamesFailed !== payload.gamesAttempted) {
    throw new SyncInvocationError("invalid_game_counts", httpStatus);
  }
  if (!Number.isInteger(payload.snapshotsPersisted)
    || payload.snapshotsPersisted !== payload.gamesSucceeded) {
    throw new SyncInvocationError("snapshot_persistence_mismatch", httpStatus);
  }
  if (typeof payload.lastSuccessfulSyncAt !== "string"
    || !Number.isFinite(Date.parse(payload.lastSuccessfulSyncAt))) {
    throw new SyncInvocationError("invalid_success_timestamp", httpStatus);
  }
  if ((payload.status === "success" && payload.gamesFailed !== 0)
    || (payload.status === "partial" && payload.gamesFailed === 0)
    || (payload.status !== "success" && payload.status !== "partial")) {
    throw new SyncInvocationError("invalid_sync_status", httpStatus);
  }

  return {
    outcome: payload.status,
    generation: payload.generation,
    gamesAttempted: payload.gamesAttempted,
    gamesSucceeded: payload.gamesSucceeded,
    gamesFailed: payload.gamesFailed,
    snapshotsPersisted: payload.snapshotsPersisted,
    lastSuccessfulSyncAt: payload.lastSuccessfulSyncAt,
  };
}

function isCompletedSyncFailure(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    && payload.ok === false
    && (payload.status === "failed" || payload.status === "not-configured")
    && typeof payload.lockAcquired === "boolean"
    && Array.isArray(payload.errors);
}

export async function invokeScheduleSync({
  fetchImpl = fetch,
  secret,
  waitImpl = pause,
  nowImpl = Date.now,
  timeoutSignalImpl = (milliseconds) => AbortSignal.timeout(milliseconds),
}) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new SyncInvocationError("missing_configuration");
  }

  const deadline = nowImpl() + INVOCATION_BUDGET_MS;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const remainingBudget = deadline - nowImpl();
    if (remainingBudget <= 0) throw new SyncInvocationError("retry_budget_exhausted");

    let response;
    try {
      response = await fetchImpl(SYNC_URL, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${secret}`,
          "cache-control": "no-store",
        },
        redirect: "error",
        signal: timeoutSignalImpl(Math.min(REQUEST_TIMEOUT_MS, remainingBudget)),
      });
    } catch {
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (deadline - nowImpl() <= delay) throw new SyncInvocationError("retry_budget_exhausted");
        await waitImpl(delay);
        continue;
      }
      throw new SyncInvocationError("network_failure");
    }

    if (response.status === 503
      && /^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      let payload;
      try {
        payload = await readJsonBody(response);
      } catch (error) {
        if (attempt === MAX_ATTEMPTS - 1) throw error;
        const delay = retryDelayFor(response, attempt, nowImpl());
        if (deadline - nowImpl() <= delay) throw new SyncInvocationError("retry_budget_exhausted");
        await waitImpl(delay);
        continue;
      }

      // The sync endpoint uses structured 503 responses for a completed
      // failed/not-configured run. Repeating that whole run immediately can
      // amplify provider throttling and database outages; let the next
      // scheduled trigger retry instead.
      if (isCompletedSyncFailure(payload)) {
        throw new SyncInvocationError("sync_failed", response.status);
      }

      if (attempt === MAX_ATTEMPTS - 1) return validateSyncPayload(payload, response.status);
      const delay = retryDelayFor(response, attempt, nowImpl());
      if (deadline - nowImpl() <= delay) throw new SyncInvocationError("retry_budget_exhausted");
      await waitImpl(delay);
      continue;
    }

    if ((response.status >= 500 || response.status === 429)
      && attempt < RETRY_DELAYS_MS.length) {
      try {
        await response.body?.cancel();
      } catch {
        // Retrying is bounded even if the response stream cannot be released.
      }
      const delay = retryDelayFor(response, attempt, nowImpl());
      if (deadline - nowImpl() <= delay) throw new SyncInvocationError("retry_budget_exhausted");
      await waitImpl(delay);
      continue;
    }

    const payload = await readJsonBody(response);
    return validateSyncPayload(payload, response.status);
  }

  throw new SyncInvocationError("retry_budget_exhausted");
}

export function createScheduleSyncWorker({ fetchImpl = fetch, log = console, waitImpl = pause } = {}) {
  return {
    async fetch() {
      return new Response("Not Found", { status: 404 });
    },

    async scheduled(controller, env) {
      // Do not let the platform replay a failed sync outside our bounded retry
      // policy. The application lock and fencing generation remain authoritative.
      controller.noRetry?.();
      const scheduledTime = Number.isFinite(controller.scheduledTime)
        ? new Date(controller.scheduledTime).toISOString()
        : null;

      try {
        const result = await invokeScheduleSync({ fetchImpl, secret: env.CRON_SECRET, waitImpl });
        const summary = { event: "schedule_sync", scheduledTime, ...result };
        if (result.outcome === "skipped_busy") log.warn(JSON.stringify(summary));
        else log.log(JSON.stringify(summary));
        return result;
      } catch (error) {
        const code = error instanceof SyncInvocationError ? error.code : "internal_failure";
        const httpStatus = error instanceof SyncInvocationError ? error.httpStatus : null;
        log.error(JSON.stringify({ event: "schedule_sync", outcome: "failed", code, httpStatus, scheduledTime }));
        // Never propagate provider bodies, URLs, headers, or transport details.
        throw new Error("schedule sync invocation failed");
      }
    },
  };
}

export default createScheduleSyncWorker();
