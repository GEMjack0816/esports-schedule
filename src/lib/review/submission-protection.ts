import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { ipAddress } from "@vercel/functions";

export const PUBLIC_SUBMISSION_POLICY = {
  // A single source may submit five validated requests in each 15 minute window.
  maxPerSource: 5,
  windowMs: 15 * 60 * 1_000,
  // Global work is capped independently of source identity so address rotation cannot bypass it.
  maxGlobalRequests: 300,
  // At most 100 previously unseen sources may create persistent limiter state per window.
  maxNewSources: 100,
  maxPending: 500,
  queueRetryAfterSeconds: 15 * 60,
  busyRetryAfterSeconds: 5,
  // The gate uses bounded try-lock retries instead of an unbounded advisory lock wait.
  gateLockMaxWaitMs: 200,
  gateLockRetryMs: 20,
  statementTimeoutMs: 2_000,
  rowLockTimeoutMs: 250,
  // Cleanup runs at most once per interval and deletes at most one fixed batch.
  cleanupIntervalMs: 5 * 60 * 1_000,
  sourceRetentionMs: 60 * 60 * 1_000,
  cleanupBatchSize: 200,
  counterNamespace: "public-submission-v1",
} as const;

export const PUBLIC_SUBMISSION_GATE_LOCK = 1_908_218_316;

export type SubmissionControlWindowKind = "global-requests" | "new-sources" | "cleanup";

export type PublicSubmissionPolicy = {
  maxPerSource: number;
  windowMs: number;
  maxGlobalRequests: number;
  maxNewSources: number;
  maxPending: number;
  queueRetryAfterSeconds: number;
  busyRetryAfterSeconds: number;
  gateLockMaxWaitMs: number;
  gateLockRetryMs: number;
  statementTimeoutMs: number;
  rowLockTimeoutMs: number;
  cleanupIntervalMs: number;
  sourceRetentionMs: number;
  cleanupBatchSize: number;
  counterNamespace: string;
};

export function submissionControlWindowKey(
  namespace: string,
  kind: SubmissionControlWindowKind,
): string {
  return `${namespace}:${kind}`;
}

function normalizedSourceIp(request: Request): string {
  const candidate = ipAddress(request)?.trim() ?? "";
  return isIP(candidate) ? candidate : "unknown";
}

export function submissionSourceHash(request: Request): string {
  return createHash("sha256")
    .update(`esports-schedule-public-submission\0${normalizedSourceIp(request)}`)
    .digest("hex");
}
