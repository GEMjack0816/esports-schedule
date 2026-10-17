import { pathToFileURL } from "node:url";

const HEALTH_URL =
  "https://esports-schedule-two.vercel.app/api/health/data-coverage";
const MAX_AGE_SECONDS = 15 * 60;
const MAX_FUTURE_SKEW_SECONDS = 2 * 60;
const MAX_RESPONSE_BYTES = 128 * 1024;
const GAME_KEYS = ["lol", "valorant", "honor-of-kings", "cs2", "dota2"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function getTimestampAgeSeconds(value, now) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const skewSeconds = (timestamp - now.getTime()) / 1000;
  if (skewSeconds > MAX_FUTURE_SKEW_SECONDS) return null;
  return Math.max(0, (now.getTime() - timestamp) / 1000);
}

function addAgeProblem(problems, label, seconds) {
  if (seconds === null) {
    problems.push(
      `${label} timestamp is missing, invalid, or too far in the future`,
    );
  } else if (seconds > MAX_AGE_SECONDS) {
    problems.push(`${label} is older than ${MAX_AGE_SECONDS} seconds`);
  }
}

export function inspectScheduleFreshness(payload, now = new Date()) {
  const problems = [];
  if (!isRecord(payload)) {
    return { ok: false, problems: ["health response must be a JSON object"] };
  }

  if (payload.mode !== "live") problems.push("schedule mode is not live");
  if (payload.demoMode !== false) problems.push("demo mode must be false");
  if (payload.stale !== false) problems.push("schedule is marked stale");

  if (
    !Number.isSafeInteger(payload.snapshotAgeSeconds) ||
    payload.snapshotAgeSeconds < 0
  ) {
    problems.push("snapshotAgeSeconds is missing or invalid");
  } else if (payload.snapshotAgeSeconds > MAX_AGE_SECONDS) {
    problems.push(`snapshotAgeSeconds exceeds ${MAX_AGE_SECONDS}`);
  }
  addAgeProblem(
    problems,
    "sourceFetchedAt",
    getTimestampAgeSeconds(payload.sourceFetchedAt, now),
  );
  addAgeProblem(
    problems,
    "lastSuccessfulSyncAt",
    getTimestampAgeSeconds(payload.lastSuccessfulSyncAt, now),
  );

  if (!isRecord(payload.games)) {
    problems.push("per-game coverage is missing");
  } else {
    for (const game of GAME_KEYS) {
      const coverage = payload.games[game];
      if (!isRecord(coverage)) {
        problems.push(`${game} coverage is missing`);
        continue;
      }
      if (coverage.syncStatus !== "normal") {
        problems.push(`${game} sync status is not normal`);
      }
      if (
        !Number.isSafeInteger(coverage.snapshotAgeSeconds) ||
        coverage.snapshotAgeSeconds < 0
      ) {
        problems.push(`${game} snapshotAgeSeconds is missing or invalid`);
      } else if (coverage.snapshotAgeSeconds > MAX_AGE_SECONDS) {
        problems.push(
          `${game} snapshot is older than ${MAX_AGE_SECONDS} seconds`,
        );
      }
      addAgeProblem(
        problems,
        `${game} sourceFetchedAt`,
        getTimestampAgeSeconds(coverage.sourceFetchedAt, now),
      );
      addAgeProblem(
        problems,
        `${game} lastSuccessfulSyncAt`,
        getTimestampAgeSeconds(coverage.lastSuccessfulSyncAt, now),
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

async function readBodyWithLimit(response) {
  if (!response.body) throw new Error("missing body");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

export async function checkScheduleHealth(fetchImpl = fetch, now = new Date()) {
  let response;
  try {
    response = await fetchImpl(HEALTH_URL, {
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {
      ok: false,
      problems: ["health endpoint request failed or timed out"],
    };
  }

  if (response.status !== 200) {
    return {
      ok: false,
      problems: [`health endpoint returned HTTP ${response.status}`],
    };
  }
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      response.headers.get("content-type") ?? "",
    )
  ) {
    return {
      ok: false,
      problems: ["health endpoint did not return application/json"],
    };
  }

  const cacheControl = response.headers.get("cache-control") ?? "";
  const cacheDirectives = cacheControl
    .split(",")
    .map((directive) => directive.trim().toLowerCase());
  if (!cacheDirectives.includes("no-store")) {
    return {
      ok: false,
      problems: ["health endpoint response is missing the no-store cache directive"],
    };
  }

  let payload;
  try {
    payload = JSON.parse(await readBodyWithLimit(response));
  } catch {
    return {
      ok: false,
      problems: ["health response was unreadable or exceeded the size limit"],
    };
  }
  return inspectScheduleFreshness(payload, now);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await checkScheduleHealth();
  if (!result.ok) {
    console.error("Schedule freshness check FAILED:");
    for (const problem of result.problems) console.error(`- ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(
      "Schedule freshness check PASS: all five game snapshots are live and within the 15-minute freshness window.",
    );
  }
}
