import "server-only";

import { getCache } from "@vercel/functions";
import { getReviewRepository } from "./repository";
import type { DrizzleReviewRepository } from "./repository";
import { validateSubmission } from "@/lib/submissions";
import type { LegacyImportResult, LegacySubmissionImportRecord } from "./types";

const INDEX_KEY = "pending-index-v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function legacyCache() {
  return getCache({ namespace: "esports-schedule-submissions" });
}

export async function importLegacyRuntimeSubmissions(
  actorId: string,
  repository: DrizzleReviewRepository = getReviewRepository(),
): Promise<LegacyImportResult> {
  const cache = legacyCache();
  const index = await cache.get(INDEX_KEY);
  const ids = Array.isArray(index)
    ? [...new Set(index.filter((value): value is string => typeof value === "string"))]
    : [];
  const records: LegacySubmissionImportRecord[] = [];
  let invalid = 0;

  for (const id of ids) {
    if (!UUID_PATTERN.test(id)) {
      invalid += 1;
      continue;
    }

    // A cache read failure is an incomplete import, not an invalid legacy
    // record. Let it abort before the repository transaction can commit a
    // misleading partial import and audit result.
    const raw = await cache.get(`pending:${id}`);
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
    } catch {
      invalid += 1;
    }
  }

  return repository.importLegacySubmissions(actorId, records, {
    scanned: ids.length,
    invalid,
  });
}

