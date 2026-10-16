import fs from "node:fs";
import { pathToFileURL } from "node:url";

// The fixture workflow runs every 15 minutes; reject otherwise-successful
// responses when the last-known-good snapshot is already outside that window.
const MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1_000;
// Allow small runner/runtime clock skew without accepting a forged future date.
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1_000;

function isFreshTimestamp(value, now) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age <= MAX_SNAPSHOT_AGE_MS && age >= -MAX_FUTURE_SKEW_MS;
}

export function validateSyncResponse(payload, httpStatus, now = Date.now()) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, message: "sync endpoint returned invalid JSON" };
  }
  if (payload.status === "busy" && payload.lockAcquired === false) {
    if (payload.generation !== null && payload.generation !== undefined) {
      return { ok: false, message: "sync busy response unexpectedly reported a generation" };
    }
    return httpStatus === 409
      ? { ok: true, message: "sync busy: another refresh owns the lock" }
      : { ok: false, message: `sync busy response used unexpected HTTP ${httpStatus}` };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { ok: false, message: `sync endpoint returned HTTP ${httpStatus}` };
  }
  if (payload.lockAcquired !== true) {
    return { ok: false, message: "sync did not acquire the refresh lock" };
  }
  if (!Number.isSafeInteger(payload.generation) || payload.generation < 1) {
    return { ok: false, message: "sync did not report a valid fencing generation" };
  }
  if (!Number.isInteger(payload.gamesAttempted) || payload.gamesAttempted < 1) {
    return { ok: false, message: "sync did not report attempted games" };
  }
  if (!Number.isInteger(payload.gamesSucceeded) || payload.gamesSucceeded < 1) {
    return { ok: false, message: "sync did not update any game" };
  }
  if (!Number.isInteger(payload.snapshotsPersisted) || payload.snapshotsPersisted < 1) {
    return { ok: false, message: "sync did not persist a valid snapshot" };
  }
  if (payload.snapshotsPersisted !== payload.gamesSucceeded) {
    return { ok: false, message: "sync success count does not match persisted snapshots" };
  }
  if (!Number.isInteger(payload.gamesFailed)
    || payload.gamesSucceeded + payload.gamesFailed !== payload.gamesAttempted) {
    return { ok: false, message: "sync game outcome counts are inconsistent" };
  }
  if (!isFreshTimestamp(payload.sourceFetchedAt, now)) {
    return { ok: false, message: "sync snapshot sourceFetchedAt is missing, stale, or too far in the future" };
  }
  if (!isFreshTimestamp(payload.lastSuccessfulSyncAt, now)) {
    return { ok: false, message: "sync lastSuccessfulSyncAt is missing, stale, or too far in the future" };
  }
  if (Date.parse(payload.lastSuccessfulSyncAt) < Date.parse(payload.sourceFetchedAt)) {
    return { ok: false, message: "sync timestamps are inconsistent" };
  }
  if (payload.status !== "success" && payload.status !== "partial") {
    return { ok: false, message: `sync reported logical status ${String(payload.status)}` };
  }
  return {
    ok: true,
    message: `${payload.status}: ${payload.gamesSucceeded} games updated, ${payload.gamesFailed} failed`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filePath, rawHttpStatus] = process.argv.slice(2);
  if (!filePath || !rawHttpStatus) {
    console.error("sync response validator requires a response file and HTTP status");
    process.exit(2);
  }
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    console.error("sync endpoint returned unreadable JSON");
    process.exit(1);
  }
  const result = validateSyncResponse(payload, Number(rawHttpStatus));
  console.log(result.message);
  if (!result.ok) process.exit(1);
}
