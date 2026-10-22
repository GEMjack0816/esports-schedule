import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const PANDA_GAMES = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"];
export const DEFAULT_MAX_AGE_SECONDS = 15 * 60;

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function getAgeSeconds(value, now) {
  return Math.floor((now - Date.parse(value)) / 1_000);
}

function timestampAgeError(name, value, now, maxAgeSeconds) {
  if (!validTimestamp(value)) return `${name} is missing or invalid`;
  const ageSeconds = getAgeSeconds(value, now);
  if (ageSeconds < -60) return `${name} is more than 60s in the future`;
  if (ageSeconds > maxAgeSeconds) return `${name} is ${ageSeconds}s old (maximum ${maxAgeSeconds}s)`;
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
  try {
    payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    console.error("health endpoint returned unreadable JSON");
    process.exit(1);
  }
  const maxAgeSeconds = Number(process.env.MAX_SCHEDULE_AGE_SECONDS ?? DEFAULT_MAX_AGE_SECONDS);
  const result = validateScheduleFreshness(payload, Number(rawHttpStatus), Date.now(), maxAgeSeconds);
  console.log(result.message);
  if (!result.ok) process.exit(1);
}
