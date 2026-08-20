import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { ipAddress } from "@vercel/functions";

export const PUBLIC_SUBMISSION_POLICY = {
  maxPerSource: 5,
  windowMs: 15 * 60 * 1_000,
  maxPending: 500,
  queueRetryAfterSeconds: 15 * 60,
} as const;

export type PublicSubmissionPolicy = {
  maxPerSource: number;
  windowMs: number;
  maxPending: number;
  queueRetryAfterSeconds: number;
};

function normalizedSourceIp(request: Request): string {
  const candidate = ipAddress(request)?.trim() ?? "";
  return isIP(candidate) ? candidate : "unknown";
}

export function submissionSourceHash(request: Request): string {
  return createHash("sha256")
    .update(`esports-schedule-public-submission\0${normalizedSourceIp(request)}`)
    .digest("hex");
}
