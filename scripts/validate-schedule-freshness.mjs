import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const PANDA_GAMES = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"];
export const DEFAULT_MAX_AGE_SECONDS = 15 * 60;
export const DEFAULT_MAX_HEALTH_RESPONSE_BYTES = 256 * 1024;

function escapeMarkdown(value) {
  return value.replace(/[\\`*_{}\[\]()#+.!|<>]/g, "\\$&");
}

export function sanitizeFreshnessMessage(message) {
  return String(message ?? "freshness check returned no detail")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

export function formatFreshnessStepSummary(result) {
  const status = result.ok ? "PASS" : "FAIL";
  const message = sanitizeFreshnessMessage(result.message);
  return `### Schedule freshness: ${status}\n\n${escapeMarkdown(message)}\n`;
}

function appendStepSummary(result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  try {
    fs.appendFileSync(summaryPath, formatFreshnessStepSummary(result), "utf8");
  } catch {
    // The summary is useful presentation, but must not replace the actual health result.
    console.warn("could not write GitHub Actions step summary");
  }
}

const EXPLICIT_TIMEZONE_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;

function validTimestamp(value) {
  if (typeof value !== "string" || !EXPLICIT_TIMEZONE_TIMESTAMP.test(value)) return false;

  const datePart = value.slice(0, 10);
  const calendarDate = new Date(`${datePart}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== datePart) {
    return false;
  }

  const offset = value.match(/[+-](\d{2}):(\d{2})$/);
  if (offset && Number(offset[1]) === 14 && Number(offset[2]) !== 0) return false;
  return Number.isFinite(Date.parse(value));
}

function timestampAgeError(name, value, now, maxAgeSeconds) {
  if (!validTimestamp(value)) return `${name} is missing or invalid`;
  const ageMilliseconds = now - Date.parse(value);
  const ageSeconds = Math.ceil(ageMilliseconds / 1_000);
  if (ageMilliseconds < -60_000) return `${name} is more than 60s in the future`;
  if (ageMilliseconds > maxAgeSeconds * 1_000) {
    return `${name} is ${ageSeconds}s old (maximum ${maxAgeSeconds}s)`;
  }
  return null;
}

export function validateScheduleFreshness(
  payload,
  httpStatus,
  now = Date.now(),
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "health endpoint returned invalid JSON" };
  }
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus >= 300) {
    return { ok: false, message: `health endpoint returned HTTP ${httpStatus}` };
  }
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) {
    return { ok: false, message: "freshness threshold must be a positive integer" };
  }
  if (payload.mode !== "live" || payload.demoMode !== false) {
    return { ok: false, message: "schedule is not serving live provider data" };
  }

  const timestamps = [
    ["sourceFetchedAt", payload.sourceFetchedAt],
    ["lastSuccessfulSyncAt", payload.lastSuccessfulSyncAt],
  ];
  for (const [name, value] of timestamps) {
    const error = timestampAgeError(name, value, now, maxAgeSeconds);
    if (error) return { ok: false, message: error };
  }

  if (payload.stale !== false) {
    return { ok: false, message: "health response reports stale schedule data" };
  }

  if (!payload.games || typeof payload.games !== "object" || Array.isArray(payload.games)) {
    return { ok: false, message: "health response is missing per-game coverage" };
  }
  for (const game of PANDA_GAMES) {
    const coverage = payload.games[game];
    if (!coverage || typeof coverage !== "object") {
      return { ok: false, message: `health response is missing ${game} coverage` };
    }
    if (coverage.syncStatus !== "normal") {
      return { ok: false, message: `${game} sync status is ${String(coverage.syncStatus ?? "unknown")}` };
    }
    for (const field of ["sourceFetchedAt", "lastSuccessfulSyncAt"]) {
      const value = coverage[field];
      const error = timestampAgeError(`${game} ${field}`, value, now, maxAgeSeconds);
      if (error) return { ok: false, message: error };
    }
  }

  return {
    ok: true,
    message: `fresh: all ${PANDA_GAMES.length} games are within ${maxAgeSeconds}s`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filePath, rawHttpStatus] = process.argv.slice(2);
  if (!filePath || !rawHttpStatus) {
    console.error("freshness validator requires a response file and HTTP status");
    process.exit(2);
  }
  let payload;
  let parseError = false;
  let oversized = false;
  const maxResponseBytes = Number(
    process.env.MAX_HEALTH_RESPONSE_BYTES ?? DEFAULT_MAX_HEALTH_RESPONSE_BYTES,
  );
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    console.error("freshness validator response size limit must be a positive integer");
    process.exit(2);
  }
  try {
    if (fs.statSync(filePath).size > maxResponseBytes) {
      oversized = true;
    } else {
      payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {
    parseError = true;
  }
  const result = oversized
    ? { ok: false, message: `health endpoint response exceeds ${maxResponseBytes} bytes` }
    : parseError
      ? { ok: false, message: "health endpoint returned unreadable JSON" }
    : validateScheduleFreshness(
      payload,
      Number(rawHttpStatus),
      Date.now(),
      Number(process.env.MAX_SCHEDULE_AGE_SECONDS ?? DEFAULT_MAX_AGE_SECONDS),
    );
  console.log(sanitizeFreshnessMessage(result.message));
  appendStepSummary(result);
  if (!result.ok) process.exit(1);
}
