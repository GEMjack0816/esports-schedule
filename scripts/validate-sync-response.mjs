import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function validateSyncResponse(payload, httpStatus) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, message: "sync endpoint returned invalid JSON" };
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) {
    return { ok: false, message: "sync endpoint returned an invalid HTTP status" };
  }
  if (payload.status === "busy" && payload.lockAcquired === false) {
    if (payload.generation !== null && payload.generation !== undefined) {
      return { ok: false, message: "sync busy response unexpectedly reported a generation" };
    }
    return httpStatus === 409
      ? { ok: false, message: "sync busy: another refresh owns the lock; this invocation did not refresh" }
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
  if (!Number.isInteger(payload.gamesSucceeded)
    || payload.gamesSucceeded < 1
    || payload.gamesSucceeded > payload.gamesAttempted) {
    return { ok: false, message: "sync did not update any game" };
  }
  if (!Number.isInteger(payload.snapshotsPersisted) || payload.snapshotsPersisted < 1) {
    return { ok: false, message: "sync did not persist a valid snapshot" };
  }
  if (payload.snapshotsPersisted !== payload.gamesSucceeded) {
    return { ok: false, message: "sync success count does not match persisted snapshots" };
  }
  if (!Number.isInteger(payload.gamesFailed)
    || payload.gamesFailed < 0
    || payload.gamesSucceeded + payload.gamesFailed !== payload.gamesAttempted) {
    return { ok: false, message: "sync game outcome counts are inconsistent" };
  }
  if (typeof payload.lastSuccessfulSyncAt !== "string" || Number.isNaN(Date.parse(payload.lastSuccessfulSyncAt))) {
    return { ok: false, message: "sync did not report a valid lastSuccessfulSyncAt" };
  }
  if (payload.status !== "success" && payload.status !== "partial") {
    return { ok: false, message: `sync reported logical status ${String(payload.status)}` };
  }
  if ((payload.status === "success" && payload.gamesFailed !== 0)
    || (payload.status === "partial" && payload.gamesFailed === 0)) {
    return { ok: false, message: "sync status does not match game outcome counts" };
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
