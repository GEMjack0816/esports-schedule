import "server-only";

import { getCache } from "@vercel/functions";
import { getReviewRepository } from "./repository";
import type { DrizzleReviewRepository } from "./repository";
import { validateSubmission } from "@/lib/submissions";
import type { LegacyImportCounts, LegacySubmissionImportRecord } from "./types";

const INDEX_KEY = "pending-index-v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function legacyCache() {
  return getCache({ namespace: "esports-schedule-submissions" });
}

export async function importLegacyRuntimeSubmissions(
  actorId: string,
  repository: DrizzleReviewRepository = getReviewRepository(),
): Promise<LegacyImportCounts> {
  const cache = legacyCache();
  const index = await cache.get(INDEX_KEY);
  if (
    index !== undefined
    && index !== null
    && (!Array.isArray(index) || index.some((value) => typeof value !== "string"))
  ) {
    // A malformed index cannot safely be treated as empty or partially read.
    // Abort before repository writes so the audit cannot claim a partial import.
    throw new Error("Legacy submission index is invalid.");
  }
  const ids = Array.isArray(index)
    ? [...new Set(index)]
    : [];
  const records: LegacySubmissionImportRecord[] = [];
  let invalid = 0;

  for (const id of ids) {
    if (!UUID_PATTERN.test(id)) {
      invalid += 1;
      continue;
    }

    let raw: unknown;
    try {
      raw = await cache.get(`pending:${id}`);
    } catch {
      // A cache read failure is not evidence that the record is malformed.
      // Abort before database writes so an outage cannot produce a misleading
      // partial import and aggregate audit event.
      throw new Error("LEGACY_RUNTIME_CACHE_READ_FAILED");
    }

    if (!raw || typeof raw !== "object") {
      invalid += 1;
      continue;
    }

    try {
      const record = raw as Record<string, unknown>;
      const submittedAt = typeof record.submittedAt === "string"
        ? new Date(record.submittedAt)
        : new Date(Number.NaN);
      if (Number.isNaN(submittedAt.getTime())) throw new Error("invalid time");
      const input = validateSubmission({ ...record, notes: record.notes ?? null });
      records.push({ id, input, submittedAt });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error
        && (error as { code?: string }).code === "DATABASE_UNAVAILABLE") {
        throw error;
      }
      invalid += 1;
    }
  }

  return repository.importLegacySubmissions(actorId, records, ids.length, invalid);
}
