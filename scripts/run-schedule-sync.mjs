import { pathToFileURL } from "node:url";
import { validateSyncResponse } from "./validate-sync-response.mjs";

const SYNC_URL = "https://esports-schedule-two.vercel.app/api/cron/sync";
const HEALTH_URL = "https://esports-schedule-two.vercel.app/api/health/data-coverage";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_BODY_CHUNKS = 1_024;
const SYNC_TIMEOUT_MS = 300_000;
const HEALTH_TIMEOUT_MS = 10_000;
// Leave a five-minute guard band below the 15-minute scheduled cadence. If a
// run starts just before the app's stale boundary, it must refresh now rather
// than skip and leave the schedule stale until the following trigger.
const FRESHNESS_LIMIT_SECONDS = 10 * 60;
const GAMES = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"];
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class ScheduleSyncRunError extends Error {
  constructor(code) {
    super(code);
    this.name = "ScheduleSyncRunError";
    this.code = code;
  }
}

function parseTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return null;
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const offset = value.match(/([+-])(\d{2}):(\d{2})$/);
  const offsetHour = offset ? Number(offset[2]) : 0;
  const offsetMinute = offset ? Number(offset[3]) : 0;
  const unknownOffset = offset?.[1] === "-" && offsetHour === 0 && offsetMinute === 0;
  if (hour > 23 || minute > 59 || second > 59
    || unknownOffset
    || (offset && (offsetHour > 14 || (offsetHour === 14 && offsetMinute !== 0) || offsetMinute > 59))) {
    return null;
  }
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function readJsonBody(response) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new ScheduleSyncRunError("invalid_response_content_type");
  }
  if (!response.body) throw new ScheduleSyncRunError("missing_response_body");

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let chunkCount = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount += 1;
      if (chunkCount > MAX_BODY_CHUNKS) {
        try {
          void reader.cancel().catch(() => {});
        } catch {
          // Cancellation is best-effort; keep the parser work strictly bounded.
        }
        throw new ScheduleSyncRunError("response_too_many_chunks");
      }
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        try {
          void reader.cancel().catch(() => {});
        } catch {
          // Cancellation is best-effort; the bounded parsing failure is final.
        }
        throw new ScheduleSyncRunError("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ScheduleSyncRunError("invalid_response_json");
  }
}

function hasStrictNoStorePolicy(value) {
  if (typeof value !== "string") return false;
  const directives = value.split(",").map((directive) => directive.trim().toLowerCase());
  return directives.includes("no-store") && !directives.some((directive) =>
    /^(?:public|max-age|s-maxage|stale-while-revalidate|stale-if-error)(?:\s*=|\s*$)/.test(directive));
}

function getSuccessfulSyncTimestamp(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? parseTimestamp(payload.lastSuccessfulSyncAt)
    : null;
}

function isFreshFiveGameSnapshot(payload, now) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || payload.mode !== "live"
    || payload.demoMode !== false
    || payload.stale !== false
    || payload.refreshInProgress !== false
    || payload.providers?.pandascore !== "connected"
    || !Number.isInteger(payload.snapshotAgeSeconds)
    || payload.snapshotAgeSeconds < 0
    || payload.snapshotAgeSeconds > FRESHNESS_LIMIT_SECONDS) {
    return false;
  }

  const sourceFetchedAt = parseTimestamp(payload.sourceFetchedAt);
  const lastSuccessfulSyncAt = getSuccessfulSyncTimestamp(payload);
  if (sourceFetchedAt === null || lastSuccessfulSyncAt === null
    || sourceFetchedAt > lastSuccessfulSyncAt
    || lastSuccessfulSyncAt > now
    || (now - sourceFetchedAt) / 1_000 > FRESHNESS_LIMIT_SECONDS) {
    return false;
  }
  const timestampAgeSeconds = (now - sourceFetchedAt) / 1_000;
  if (timestampAgeSeconds < -60
    || Math.abs(timestampAgeSeconds - payload.snapshotAgeSeconds) > 60) {
    return false;
  }

  if (!payload.games || typeof payload.games !== "object" || Array.isArray(payload.games)) return false;
  return GAMES.every((game) => {
    const state = payload.games[game];
    const gameSourceFetchedAt = parseTimestamp(state?.sourceFetchedAt);
    const gameLastSuccessfulSyncAt = parseTimestamp(state?.lastSuccessfulSyncAt);
    const gameSnapshotAgeSeconds = state?.snapshotAgeSeconds;
    const gameTimestampAgeSeconds = gameSourceFetchedAt === null
      ? null
      : (now - gameSourceFetchedAt) / 1_000;
    return state?.syncStatus === "normal"
      && gameSourceFetchedAt !== null
      && gameLastSuccessfulSyncAt !== null
      && Number.isSafeInteger(gameSnapshotAgeSeconds)
      && gameSnapshotAgeSeconds >= 0
      && gameSnapshotAgeSeconds <= FRESHNESS_LIMIT_SECONDS
      && gameTimestampAgeSeconds !== null
      && gameTimestampAgeSeconds >= -60
      && Math.abs(gameTimestampAgeSeconds - gameSnapshotAgeSeconds) <= 60
      && gameSourceFetchedAt <= gameLastSuccessfulSyncAt
      && gameLastSuccessfulSyncAt <= now
      && (now - gameSourceFetchedAt) / 1_000 <= FRESHNESS_LIMIT_SECONDS
      && (now - gameLastSuccessfulSyncAt) / 1_000 <= FRESHNESS_LIMIT_SECONDS;
  });
}

async function readHealth({ fetchImpl, timeoutSignalImpl }) {
  try {
    const response = await fetchImpl(HEALTH_URL, {
      method: "GET",
      headers: { accept: "application/json", "cache-control": "no-store" },
      redirect: "error",
      signal: timeoutSignalImpl(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok || !hasStrictNoStorePolicy(response.headers.get("cache-control"))) return null;
    return await readJsonBody(response);
  } catch {
    return null;
  }
}

async function verifyFreshnessAdvanced({ fetchImpl, timeoutSignalImpl, nowImpl, baseline }) {
  if (baseline === null) return null;
  const payload = await readHealth({ fetchImpl, timeoutSignalImpl });
  const lastSuccessfulSyncAt = getSuccessfulSyncTimestamp(payload);
  const now = nowImpl();
  if (!isFreshFiveGameSnapshot(payload, now)
    || lastSuccessfulSyncAt === null
    || lastSuccessfulSyncAt <= baseline) {
    return null;
  }
  return {
    ok: true,
    outcome: "verified_fresh_after_ambiguous_response",
    lastSuccessfulSyncAt: payload.lastSuccessfulSyncAt,
  };
}

async function verifyCompletedSyncFreshness({
  fetchImpl,
  timeoutSignalImpl,
  nowImpl,
  baseline,
  syncTimestamp,
}) {
  const payload = await readHealth({ fetchImpl, timeoutSignalImpl });
  const lastSuccessfulSyncAt = getSuccessfulSyncTimestamp(payload);
  const now = nowImpl();
  if (!isFreshFiveGameSnapshot(payload, now)
    || lastSuccessfulSyncAt === null
    || (baseline !== null && lastSuccessfulSyncAt <= baseline)
    || (syncTimestamp !== null && lastSuccessfulSyncAt < syncTimestamp)) {
    return null;
  }
  return {
    ok: true,
    lastSuccessfulSyncAt: payload.lastSuccessfulSyncAt,
  };
}

export async function runScheduleSync({
  secret,
  fetchImpl = fetch,
  nowImpl = Date.now,
  timeoutSignalImpl = (milliseconds) => AbortSignal.timeout(milliseconds),
  force = false,
}) {
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new ScheduleSyncRunError("missing_configuration");
  }

  const before = await readHealth({ fetchImpl, timeoutSignalImpl });
  const baseline = getSuccessfulSyncTimestamp(before);
  if (!force && isFreshFiveGameSnapshot(before, nowImpl())) {
    return {
      ok: true,
      outcome: "already_fresh",
      lastSuccessfulSyncAt: before.lastSuccessfulSyncAt,
    };
  }
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
      signal: timeoutSignalImpl(SYNC_TIMEOUT_MS),
    });
  } catch {
    const recovered = await verifyFreshnessAdvanced({ fetchImpl, timeoutSignalImpl, nowImpl, baseline });
    if (recovered) return recovered;
    throw new ScheduleSyncRunError("sync_transport_failed_without_verified_refresh");
  }

  let payload;
  try {
    payload = await readJsonBody(response);
  } catch {
    if (response.ok || response.status >= 500) {
      const recovered = await verifyFreshnessAdvanced({ fetchImpl, timeoutSignalImpl, nowImpl, baseline });
      if (recovered) return recovered;
    }
    throw new ScheduleSyncRunError("sync_response_unreadable");
  }

  if (response.status >= 500) {
    const recovered = await verifyFreshnessAdvanced({ fetchImpl, timeoutSignalImpl, nowImpl, baseline });
    if (recovered) return recovered;
    throw new ScheduleSyncRunError("sync_http_failure_without_verified_refresh");
  }

  if (response.status === 409 && payload?.status === "busy" && payload.lockAcquired === false) {
    if (payload.generation !== null && payload.generation !== undefined) {
      throw new ScheduleSyncRunError("invalid_busy_response");
    }
    const recovered = await verifyFreshnessAdvanced({ fetchImpl, timeoutSignalImpl, nowImpl, baseline });
    if (recovered) return { ...recovered, outcome: "verified_fresh_after_concurrent_sync" };
    throw new ScheduleSyncRunError("sync_busy_without_verified_refresh");
  }

  const result = validateSyncResponse(payload, response.status);
  if (!result.ok) throw new ScheduleSyncRunError("sync_response_invalid");

  // A logical success (including a partial success) is not enough for the
  // scheduled freshness guarantee. Verify the public health snapshot after
  // the write so a single stale game cannot be reported as a healthy run.
  const verified = await verifyCompletedSyncFreshness({
    fetchImpl,
    timeoutSignalImpl,
    nowImpl,
    baseline,
    syncTimestamp: getSuccessfulSyncTimestamp(payload),
  });
  if (!verified) {
    throw new ScheduleSyncRunError("sync_completed_without_verified_fresh_snapshot");
  }
  return { ok: true, outcome: result.message, payload };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runScheduleSync({
      secret: process.env.CRON_SECRET,
      // Keep workflow_dispatch an explicit way to force a sync; only scheduled runs skip fresh snapshots.
      force: process.env.GITHUB_EVENT_NAME === "workflow_dispatch",
    });
    if (result.outcome === "verified_fresh_after_ambiguous_response") {
      console.log("sync response was ambiguous; health confirms a newer fresh five-game snapshot");
    } else if (result.outcome === "verified_fresh_after_concurrent_sync") {
      console.log("sync was busy; health confirms a concurrent sync produced a newer fresh five-game snapshot");
    } else {
      console.log(result.outcome);
    }
  } catch (error) {
    const code = error instanceof ScheduleSyncRunError ? error.code : "internal_failure";
    console.error(`sync run failed: ${code}`);
    process.exitCode = 1;
  }
}
