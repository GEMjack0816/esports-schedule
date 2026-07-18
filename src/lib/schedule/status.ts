import type { MatchStatus, PandaEndpointKey } from "./types";

export type MatchStatusSource = "upstream" | "endpoint" | "time" | "unknown";

export type NormalizedMatchStatus = {
  status: MatchStatus;
  source: MatchStatusSource;
  upstreamValue: string | null;
};

type StatusOptions = {
  endpoint: PandaEndpointKey;
  startTimeUtc: string | null;
  now?: Date;
  onUnknown?: (normalizedValue: string) => void;
};

function canonicalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
}

const scheduledStatuses = new Set(["not_started", "upcoming", "scheduled", "pending"]);
const runningStatuses = new Set(["running", "live", "started", "in_progress", "ongoing"]);
const finishedStatuses = new Set(["finished", "completed", "complete", "ended"]);
const postponedStatuses = new Set(["postponed", "delayed"]);
const cancelledStatuses = new Set(["canceled", "cancelled"]);
const forfeitStatuses = new Set(["forfeit", "walkover", "wo"]);

/**
 * The only PandaScore-to-site status mapping. Explicit upstream values win over
 * clock inference. The running collection itself wins over a stale scheduled
 * value because PandaScore has already classified that fixture as live.
 */
export function normalizeMatchStatus(
  rawStatus: string | null | undefined,
  options: StatusOptions,
): NormalizedMatchStatus {
  const normalized = typeof rawStatus === "string" ? canonicalize(rawStatus) : "";

  if (runningStatuses.has(normalized)) {
    return { status: "running", source: "upstream", upstreamValue: normalized };
  }
  if (finishedStatuses.has(normalized)) {
    return { status: "finished", source: "upstream", upstreamValue: normalized };
  }
  if (postponedStatuses.has(normalized)) {
    return { status: "postponed", source: "upstream", upstreamValue: normalized };
  }
  if (cancelledStatuses.has(normalized)) {
    return { status: "cancelled", source: "upstream", upstreamValue: normalized };
  }
  if (forfeitStatuses.has(normalized)) {
    return { status: "forfeit", source: "upstream", upstreamValue: normalized };
  }
  if (scheduledStatuses.has(normalized)) {
    if (options.endpoint === "running") {
      return { status: "running", source: "endpoint", upstreamValue: normalized };
    }
    return { status: "scheduled", source: "upstream", upstreamValue: normalized };
  }

  if (normalized) {
    options.onUnknown?.(normalized);
    return { status: "unknown", source: "unknown", upstreamValue: normalized };
  }

  if (options.endpoint === "running") {
    return { status: "running", source: "endpoint", upstreamValue: null };
  }
  if (options.endpoint === "past") {
    return { status: "finished", source: "endpoint", upstreamValue: null };
  }

  const startEpoch = options.startTimeUtc ? Date.parse(options.startTimeUtc) : Number.NaN;
  if (!Number.isNaN(startEpoch) && startEpoch <= (options.now ?? new Date()).getTime()) {
    return { status: "running", source: "time", upstreamValue: null };
  }
  return { status: "scheduled", source: "endpoint", upstreamValue: null };
}

/** Accepts both the current enum and legacy cache/manual spellings. */
export function normalizeStoredMatchStatus(value: unknown): MatchStatus | null {
  if (typeof value !== "string") return null;
  const normalized = canonicalize(value);
  if (scheduledStatuses.has(normalized)) return "scheduled";
  if (runningStatuses.has(normalized)) return "running";
  if (finishedStatuses.has(normalized)) return "finished";
  if (postponedStatuses.has(normalized)) return "postponed";
  if (cancelledStatuses.has(normalized)) return "cancelled";
  if (forfeitStatuses.has(normalized)) return "forfeit";
  if (normalized === "unknown") return "unknown";
  return null;
}
