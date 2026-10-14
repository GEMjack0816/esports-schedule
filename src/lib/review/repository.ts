import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDatabase, safeDatabaseErrorCode } from "@/db";
import {
  adminAuditEvents,
  manualMatchCacheOutbox,
  matchSubmissions,
  publishedManualMatches,
  submissionRateLimits,
  submissionRateLimitWindows,
} from "@/db/schema";
import type {
  MatchSubmissionRow,
  PublishedManualMatchRow,
} from "@/db/schema";
import type { MatchSubmissionInput } from "@/lib/submissions";
import { createSubmissionFingerprint } from "@/lib/submissions";
import {
  PUBLIC_SUBMISSION_GATE_LOCK,
  PUBLIC_SUBMISSION_POLICY,
  submissionControlWindowKey,
} from "./submission-protection";
import type { PublicSubmissionPolicy } from "./submission-protection";
import {
  DatabaseUnavailableError,
  DuplicateSubmissionError,
  ReviewConflictError,
  ReviewNotFoundError,
} from "./types";
import type {
  AdminSummary,
  ApprovalInput,
  LegacyInsertResult,
  ManualMatchPage,
  PublicSubmissionResult,
  PublishedMatchWrite,
  SubmissionCounts,
  SubmissionListFilters,
  SubmissionPage,
} from "./types";

type CreateOptions = {
  id?: string;
  submittedAt?: Date;
};

export type ManualMatchCacheFence = (revision: number) => Promise<void>;
const noCacheFence: ManualMatchCacheFence = async () => {};
export const MANUAL_MATCH_MUTATION_LOCK = 7_214_603_119;
const MANUAL_MATCH_LOCK_TIMEOUT_MS = 2_500;
const DELIVERED_OUTBOX_CLEANUP_BATCH = 100;

type ReviewTransaction = Parameters<Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]>[0];
type ReviewExecutor = Pick<ReviewTransaction, "execute">;

async function lockManualMatchMutations(tx: ReviewTransaction): Promise<void> {
  await tx.execute(sql`select set_config('lock_timeout', ${`${MANUAL_MATCH_LOCK_TIMEOUT_MS}ms`}, true)`);
  await tx.execute(sql`select pg_advisory_xact_lock(${MANUAL_MATCH_MUTATION_LOCK})`);
}

async function readManualMatchSequenceRevision(executor: ReviewExecutor): Promise<number> {
  // A Runtime Cache fence can be written before the DB transaction commits.
  // PostgreSQL sequences are intentionally non-transactional, so their
  // high-water mark also covers a reservation whose transaction later aborts.
  // Tagging the reconciled DB snapshot with that same mark makes the fallback
  // usable again without ever lowering a fence.
  const [row] = await executor.execute(sql`
    select case when is_called then last_value else 0 end as revision
    from public.manual_match_cache_revision_seq
  `);
  return Number(row?.revision ?? 0);
}

async function createManualMatchCacheRevision(
  tx: ReviewTransaction,
  fence: ManualMatchCacheFence,
): Promise<number> {
  const [event] = await tx.insert(manualMatchCacheOutbox).values({}).returning({
    revision: manualMatchCacheOutbox.revision,
  });
  await fence(event.revision);
  return event.revision;
}

function submissionValues(input: MatchSubmissionInput, updatedAt = new Date()) {
  return {
    game: input.game,
    league: input.league,
    teamA: input.teamA,
    teamB: input.teamB,
    scheduledAt: new Date(input.scheduledAt),
    bestOf: input.bestOf,
    sourceUrl: input.sourceUrl,
    notes: input.notes,
    fingerprint: createSubmissionFingerprint(input),
    updatedAt,
  };
}

function publishedValues(input: PublishedMatchWrite, updatedAt = new Date()) {
  return {
    ...input,
    startTimeUtc: input.startTimeUtc ? new Date(input.startTimeUtc) : null,
    updatedAt,
  };
}

function nextUpdatedAt(previous: Date, now = new Date()): Date {
  return new Date(Math.max(now.getTime(), previous.getTime() + 1));
}

function assertExpectedVersion(actual: Date, expected: Date): void {
  if (actual.getTime() !== expected.getTime()) {
    throw new ReviewConflictError("记录已经被其他管理员修改，请重新加载后再操作。");
  }
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function windowRetryAfterSeconds(windowStartedAt: Date, windowMs: number, now: Date): number {
  return Math.max(
    1,
    Math.ceil((windowStartedAt.getTime() + windowMs - now.getTime()) / 1_000),
  );
}

function auditSubmission(row: MatchSubmissionRow) {
  return {
    id: row.id,
    game: row.game,
    league: row.league,
    teamA: row.teamA,
    teamB: row.teamB,
    scheduledAt: row.scheduledAt.toISOString(),
    bestOf: row.bestOf,
    status: row.status,
    publishedMatchId: row.publishedMatchId,
  };
}

function auditMatch(row: PublishedManualMatchRow) {
  return {
    id: row.id,
    sourceSubmissionId: row.sourceSubmissionId,
    game: row.game,
    league: row.league,
    homeTeamName: row.homeTeamName,
    awayTeamName: row.awayTeamName,
    startTimeUtc: row.startTimeUtc?.toISOString() ?? null,
    status: row.status,
    hidden: row.hidden,
  };
}

function translateDatabaseError(error: unknown): never {
  const code = safeDatabaseErrorCode(error);
  if (code === "DUPLICATE") throw new DuplicateSubmissionError("已存在相同的待审核或已批准比赛。");
  throw new DatabaseUnavailableError("数据库暂时不可用。");
}

async function scalarCount(where?: SQL): Promise<number> {
  const db = getDatabase();
  const query = db.select({ value: count() }).from(matchSubmissions);
  const [row] = where ? await query.where(where) : await query;
  return Number(row?.value ?? 0);
}

export class DrizzleReviewRepository {
  async createSubmission(input: MatchSubmissionInput, options: CreateOptions = {}): Promise<MatchSubmissionRow> {
    try {
      const [row] = await getDatabase()
        .insert(matchSubmissions)
        .values({
          ...submissionValues(input),
          id: options.id,
          submittedAt: options.submittedAt,
          status: "pending",
        })
        .returning();
      return row;
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async createPublicSubmission(
    input: MatchSubmissionInput,
    sourceHash: string,
    now = new Date(),
    policy: PublicSubmissionPolicy = PUBLIC_SUBMISSION_POLICY,
  ): Promise<PublicSubmissionResult> {
    try {
      return await getDatabase().transaction(async (tx) => {
        await tx.execute(sql`select set_config(
          'statement_timeout',
          ${`${policy.statementTimeoutMs}ms`},
          true
        )`);
        await tx.execute(sql`select set_config(
          'lock_timeout',
          ${`${policy.rowLockTimeoutMs}ms`},
          true
        )`);

        const lockDeadline = Date.now() + policy.gateLockMaxWaitMs;
        let gateAcquired = false;
        do {
          const lockRows = await tx.execute<{ acquired: boolean }>(sql`
            select pg_try_advisory_xact_lock(${PUBLIC_SUBMISSION_GATE_LOCK}) as acquired
          `);
          gateAcquired = Boolean(lockRows[0]?.acquired);
          if (gateAcquired || Date.now() >= lockDeadline) break;
          await waitFor(Math.min(policy.gateLockRetryMs, Math.max(1, lockDeadline - Date.now())));
        } while (!gateAcquired);
        if (!gateAcquired) {
          return {
            kind: "service-busy" as const,
            retryAfterSeconds: policy.busyRetryAfterSeconds,
          };
        }

        const consumeControlWindow = async (
          kind: "global-requests" | "new-sources",
          maximum: number,
        ) => {
          const windowKey = submissionControlWindowKey(policy.counterNamespace, kind);
          await tx.insert(submissionRateLimitWindows).values({
            windowKey,
            windowStartedAt: now,
            requestCount: 0,
            updatedAt: now,
          }).onConflictDoNothing();
          const [current] = await tx.select().from(submissionRateLimitWindows)
            .where(eq(submissionRateLimitWindows.windowKey, windowKey)).for("update");
          if (!current) throw new Error("SUBMISSION_CONTROL_WINDOW_MISSING");

          const expired = current.windowStartedAt.getTime() + policy.windowMs <= now.getTime();
          const windowStartedAt = expired ? now : current.windowStartedAt;
          const requestCount = expired ? 0 : current.requestCount;
          if (requestCount >= maximum) {
            return {
              allowed: false as const,
              windowKey,
              retryAfterSeconds: windowRetryAfterSeconds(windowStartedAt, policy.windowMs, now),
            };
          }
          await tx.update(submissionRateLimitWindows).set({
            windowStartedAt,
            requestCount: requestCount + 1,
            updatedAt: now,
          }).where(eq(submissionRateLimitWindows.windowKey, windowKey));
          return { allowed: true as const, windowKey, retryAfterSeconds: 0 };
        };

        const cleanupKey = submissionControlWindowKey(policy.counterNamespace, "cleanup");
        await tx.insert(submissionRateLimitWindows).values({
          windowKey: cleanupKey,
          windowStartedAt: now,
          requestCount: 0,
          updatedAt: now,
        }).onConflictDoNothing();
        const [cleanupState] = await tx.select().from(submissionRateLimitWindows)
          .where(eq(submissionRateLimitWindows.windowKey, cleanupKey)).for("update");
        if (!cleanupState) throw new Error("SUBMISSION_CLEANUP_WINDOW_MISSING");
        if (cleanupState.updatedAt.getTime() + policy.cleanupIntervalMs <= now.getTime()) {
          const cutoff = new Date(now.getTime() - policy.sourceRetentionMs);
          await tx.execute(sql`
            with expired_source_limits as (
              select ${submissionRateLimits.sourceHash}
              from ${submissionRateLimits}
              where ${submissionRateLimits.updatedAt} < ${cutoff.toISOString()}
              order by ${submissionRateLimits.updatedAt} asc
              limit ${policy.cleanupBatchSize}
              for update skip locked
            )
            delete from ${submissionRateLimits}
            using expired_source_limits
            where ${submissionRateLimits.sourceHash} = expired_source_limits.source_hash
          `);
          await tx.update(submissionRateLimitWindows).set({ updatedAt: now })
            .where(eq(submissionRateLimitWindows.windowKey, cleanupKey));
        }

        const globalWindow = await consumeControlWindow("global-requests", policy.maxGlobalRequests);
        if (!globalWindow.allowed) {
          return {
            kind: "global-rate-limited" as const,
            retryAfterSeconds: globalWindow.retryAfterSeconds,
          };
        }

        const [currentSource] = await tx.select().from(submissionRateLimits)
          .where(eq(submissionRateLimits.sourceHash, sourceHash)).for("update");
        if (currentSource) {
          const expired = currentSource.windowStartedAt.getTime() + policy.windowMs <= now.getTime();
          const windowStartedAt = expired ? now : currentSource.windowStartedAt;
          const requestCount = expired ? 0 : currentSource.requestCount;
          if (requestCount >= policy.maxPerSource) {
            return {
              kind: "source-rate-limited" as const,
              retryAfterSeconds: windowRetryAfterSeconds(windowStartedAt, policy.windowMs, now),
            };
          }
          await tx.update(submissionRateLimits).set({
            windowStartedAt,
            requestCount: requestCount + 1,
            updatedAt: now,
          }).where(eq(submissionRateLimits.sourceHash, sourceHash));
        }

        const fingerprint = createSubmissionFingerprint(input);
        const [duplicate] = await tx.select({ id: matchSubmissions.id }).from(matchSubmissions)
          .where(and(
            eq(matchSubmissions.fingerprint, fingerprint),
            or(
              eq(matchSubmissions.status, "pending"),
              eq(matchSubmissions.status, "approved"),
            ),
          ))
          .limit(1);
        if (duplicate) return { kind: "duplicate" as const };

        const [pending] = await tx.select({ value: count() }).from(matchSubmissions)
          .where(eq(matchSubmissions.status, "pending"));
        if (Number(pending?.value ?? 0) >= policy.maxPending) {
          return { kind: "queue-full" as const, retryAfterSeconds: policy.queueRetryAfterSeconds };
        }

        let createdSourceState = false;
        let newSourceWindowKey: string | null = null;
        if (!currentSource) {
          const newSourceWindow = await consumeControlWindow("new-sources", policy.maxNewSources);
          if (!newSourceWindow.allowed) {
            return {
              kind: "new-source-rate-limited" as const,
              retryAfterSeconds: newSourceWindow.retryAfterSeconds,
            };
          }
          newSourceWindowKey = newSourceWindow.windowKey;
          const sourceRows = await tx.insert(submissionRateLimits).values({
            sourceHash,
            windowStartedAt: now,
            requestCount: 1,
            updatedAt: now,
          }).onConflictDoNothing().returning({ sourceHash: submissionRateLimits.sourceHash });
          createdSourceState = sourceRows.length === 1;
          if (!createdSourceState) throw new Error("SUBMISSION_RATE_LIMIT_ROW_RACE");
        }

        const rows = await tx.insert(matchSubmissions).values({
          ...submissionValues(input, now),
          submittedAt: now,
          status: "pending",
        }).onConflictDoNothing().returning();
        if (rows[0]) return { kind: "created" as const, submission: rows[0] };

        if (createdSourceState && newSourceWindowKey) {
          await tx.delete(submissionRateLimits)
            .where(eq(submissionRateLimits.sourceHash, sourceHash));
          await tx.update(submissionRateLimitWindows).set({
            requestCount: sql`greatest(${submissionRateLimitWindows.requestCount} - 1, 0)`,
            updatedAt: now,
          }).where(eq(submissionRateLimitWindows.windowKey, newSourceWindowKey));
        }
        return { kind: "duplicate" as const };
      });
    } catch (error) {
      const code = safeDatabaseErrorCode(error);
      if (code === "TIMEOUT" || code === "LOCK_TIMEOUT") {
        return {
          kind: "service-busy" as const,
          retryAfterSeconds: policy.busyRetryAfterSeconds,
        };
      }
      translateDatabaseError(error);
    }
  }

  async insertLegacySubmission(
    input: MatchSubmissionInput,
    id: string,
    submittedAt: Date,
  ): Promise<LegacyInsertResult> {
    try {
      const rows = await getDatabase()
        .insert(matchSubmissions)
        .values({
          ...submissionValues(input),
          id,
          submittedAt,
          status: "pending",
        })
        .onConflictDoNothing()
        .returning({ id: matchSubmissions.id });
      return rows.length === 1 ? "imported" : "duplicate";
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async getSubmission(id: string): Promise<MatchSubmissionRow | null> {
    try {
      const [row] = await getDatabase()
        .select()
        .from(matchSubmissions)
        .where(eq(matchSubmissions.id, id))
        .limit(1);
      return row ?? null;
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async listSubmissions(filters: SubmissionListFilters): Promise<SubmissionPage> {
    try {
      const conditions: SQL[] = [];
      if (filters.status) conditions.push(eq(matchSubmissions.status, filters.status));
      if (filters.game) conditions.push(eq(matchSubmissions.game, filters.game));
      if (filters.query) {
        const value = `%${filters.query}%`;
        conditions.push(or(
          ilike(matchSubmissions.league, value),
          ilike(matchSubmissions.teamA, value),
          ilike(matchSubmissions.teamB, value),
        )!);
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const db = getDatabase();
      const base = db.select().from(matchSubmissions);
      const countBase = db.select({ value: count() }).from(matchSubmissions);
      const ordered = (where ? base.where(where) : base).orderBy(
        filters.sort === "oldest" ? asc(matchSubmissions.submittedAt) : desc(matchSubmissions.submittedAt),
      );
      const [rows, totals] = await Promise.all([
        ordered.limit(filters.pageSize).offset((filters.page - 1) * filters.pageSize),
        where ? countBase.where(where) : countBase,
      ]);
      return {
        rows,
        total: Number(totals[0]?.value ?? 0),
        page: filters.page,
        pageSize: filters.pageSize,
      };
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async saveSubmission(
    id: string,
    input: MatchSubmissionInput,
    actorId: string,
    expectedUpdatedAt: Date,
  ): Promise<MatchSubmissionRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        const [before] = await tx.select().from(matchSubmissions)
          .where(eq(matchSubmissions.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("提交不存在。");
        if (before.status !== "pending") throw new ReviewConflictError("仅待审核提交可以编辑。");
        assertExpectedVersion(before.updatedAt, expectedUpdatedAt);
        const updatedAt = nextUpdatedAt(before.updatedAt);
        const [after] = await tx.update(matchSubmissions)
          .set(submissionValues(input, updatedAt))
          .where(and(
            eq(matchSubmissions.id, id),
            eq(matchSubmissions.status, "pending"),
            eq(matchSubmissions.updatedAt, expectedUpdatedAt),
          ))
          .returning();
        if (!after) throw new ReviewConflictError("提交状态已经变化。");
        await tx.insert(adminAuditEvents).values({
          actorId,
          action: "submission.edited",
          entityType: "match_submission",
          entityId: id,
          beforeJson: auditSubmission(before),
          afterJson: auditSubmission(after),
        });
        return after;
      });
    } catch (error) {
      if (error instanceof ReviewNotFoundError || error instanceof ReviewConflictError) throw error;
      translateDatabaseError(error);
    }
  }

  async approveSubmission(
    id: string,
    input: ApprovalInput,
    actorId: string,
    expectedUpdatedAt: Date,
    fence: ManualMatchCacheFence = noCacheFence,
  ): Promise<PublishedManualMatchRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        await lockManualMatchMutations(tx);
        const [before] = await tx.select().from(matchSubmissions)
          .where(eq(matchSubmissions.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("提交不存在。");
        if (before.status !== "pending") throw new ReviewConflictError("提交已被审核。");
        assertExpectedVersion(before.updatedAt, expectedUpdatedAt);
        const now = nextUpdatedAt(before.updatedAt);

        const [published] = await tx.insert(publishedManualMatches).values({
          ...publishedValues(input.published, now),
          sourceSubmissionId: id,
          publishedBy: actorId,
        }).returning();

        const [approved] = await tx.update(matchSubmissions)
          .set({
            ...submissionValues(input.submission, now),
            status: "approved",
            reviewedAt: now,
            reviewedBy: actorId,
            rejectionReason: null,
            publishedMatchId: published.id,
          })
          .where(and(
            eq(matchSubmissions.id, id),
            eq(matchSubmissions.status, "pending"),
            eq(matchSubmissions.updatedAt, expectedUpdatedAt),
          ))
          .returning();
        if (!approved) throw new ReviewConflictError("提交已被其他管理员审核。");

        await tx.insert(adminAuditEvents).values({
          actorId,
          action: "submission.approved",
          entityType: "match_submission",
          entityId: id,
          beforeJson: auditSubmission(before),
          afterJson: {
            submission: auditSubmission(approved),
            publishedMatch: auditMatch(published),
          },
        });
        // Publish the fence only after all fallible business/audit writes,
        // while still holding the transaction lock and before commit.
        await createManualMatchCacheRevision(tx, fence);
        return published;
      });
    } catch (error) {
      if (error instanceof ReviewNotFoundError || error instanceof ReviewConflictError) throw error;
      translateDatabaseError(error);
    }
  }

  async rejectSubmission(
    id: string,
    reason: string,
    actorId: string,
    expectedUpdatedAt: Date,
  ): Promise<MatchSubmissionRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        const [before] = await tx.select().from(matchSubmissions)
          .where(eq(matchSubmissions.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("提交不存在。");
        if (before.status !== "pending") throw new ReviewConflictError("提交已被审核。");
        assertExpectedVersion(before.updatedAt, expectedUpdatedAt);
        const updatedAt = nextUpdatedAt(before.updatedAt);
        const [after] = await tx.update(matchSubmissions).set({
          status: "rejected",
          reviewedAt: new Date(),
          reviewedBy: actorId,
          rejectionReason: reason,
          updatedAt,
        }).where(and(
          eq(matchSubmissions.id, id),
          eq(matchSubmissions.status, "pending"),
          eq(matchSubmissions.updatedAt, expectedUpdatedAt),
        )).returning();
        if (!after) throw new ReviewConflictError("提交已被其他管理员审核。");
        await tx.insert(adminAuditEvents).values({
          actorId,
          action: "submission.rejected",
          entityType: "match_submission",
          entityId: id,
          beforeJson: auditSubmission(before),
          afterJson: auditSubmission(after),
        });
        return after;
      });
    } catch (error) {
      if (error instanceof ReviewNotFoundError || error instanceof ReviewConflictError) throw error;
      translateDatabaseError(error);
    }
  }

  async getSummary(): Promise<AdminSummary> {
    try {
      const db = getDatabase();
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const [pending, approved, rejected, todayCount, publishedRows, recentEvents] = await Promise.all([
        scalarCount(eq(matchSubmissions.status, "pending")),
        scalarCount(eq(matchSubmissions.status, "approved")),
        scalarCount(eq(matchSubmissions.status, "rejected")),
        scalarCount(gte(matchSubmissions.submittedAt, today)),
        db.select({ value: count() }).from(publishedManualMatches),
        db.select().from(adminAuditEvents).orderBy(desc(adminAuditEvents.createdAt)).limit(10),
      ]);
      return {
        pending,
        approved,
        rejected,
        today: todayCount,
        publishedManualMatches: Number(publishedRows[0]?.value ?? 0),
        recentEvents,
      };
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async getSubmissionCounts(): Promise<SubmissionCounts> {
    const summary = await this.getSummary();
    return {
      pending: summary.pending,
      approved: summary.approved,
      rejected: summary.rejected,
      publishedManualMatches: summary.publishedManualMatches,
    };
  }

  async listManualMatches(page = 1, pageSize = 50): Promise<ManualMatchPage> {
    try {
      const db = getDatabase();
      const [rows, totals] = await Promise.all([
        db.select().from(publishedManualMatches)
          .orderBy(desc(publishedManualMatches.updatedAt))
          .limit(pageSize).offset((page - 1) * pageSize),
        db.select({ value: count() }).from(publishedManualMatches),
      ]);
      return { rows, total: Number(totals[0]?.value ?? 0), page, pageSize };
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async listVisibleManualMatches(): Promise<PublishedManualMatchRow[]> {
    try {
      return await getDatabase().select().from(publishedManualMatches)
        .where(eq(publishedManualMatches.hidden, false))
        .orderBy(asc(publishedManualMatches.startTimeUtc));
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async readManualMatchCacheSnapshot(): Promise<{
    rows: PublishedManualMatchRow[];
    revision: number;
    pendingRevisions: number;
  }> {
    try {
      return await getDatabase().transaction(async (tx) => {
        await lockManualMatchMutations(tx);
        const rows = await tx.select().from(publishedManualMatches)
          .where(eq(publishedManualMatches.hidden, false))
          .orderBy(asc(publishedManualMatches.startTimeUtc));
        const revision = await readManualMatchSequenceRevision(tx);
        const pendingRows = await tx.select({ value: count() }).from(manualMatchCacheOutbox)
          .where(isNull(manualMatchCacheOutbox.deliveredAt));
        return {
          rows,
          revision,
          pendingRevisions: Number(pendingRows[0]?.value ?? 0),
        };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async markManualMatchCacheDelivered(revision: number): Promise<void> {
    try {
      await getDatabase().update(manualMatchCacheOutbox).set({
        deliveredAt: new Date(),
        attemptCount: sql`${manualMatchCacheOutbox.attemptCount} + 1`,
        lastErrorCode: null,
      }).where(and(
        isNull(manualMatchCacheOutbox.deliveredAt),
        lte(manualMatchCacheOutbox.revision, revision),
      ));
      try {
        await getDatabase().execute(sql`
          delete from ${manualMatchCacheOutbox}
          where revision in (
            select revision from ${manualMatchCacheOutbox}
            where delivered_at is not null and revision < ${revision}
            order by revision asc
            limit ${DELIVERED_OUTBOX_CLEANUP_BATCH}
          )
        `);
      } catch {
        console.warn("[review-db] delivered manual match cache outbox cleanup failed");
      }
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async markManualMatchCacheDeliveryFailed(revision: number): Promise<void> {
    try {
      await getDatabase().update(manualMatchCacheOutbox).set({
        attemptCount: sql`${manualMatchCacheOutbox.attemptCount} + 1`,
        lastErrorCode: "RUNTIME_CACHE_WRITE_FAILED",
      }).where(and(
        isNull(manualMatchCacheOutbox.deliveredAt),
        lte(manualMatchCacheOutbox.revision, revision),
      ));
    } catch {
      console.warn("[review-db] manual match cache delivery failure could not be recorded");
    }
  }

  async getCurrentManualMatchRevision(): Promise<number> {
    try {
      return await readManualMatchSequenceRevision(getDatabase());
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async getManualMatchCacheStatus(): Promise<{ revision: number; pendingRevisions: number }> {
    try {
      const db = getDatabase();
      // This status is checked on every public schedule read. Keep it to one
      // database round trip instead of two independent requests, while reading
      // the pending outbox count and revision watermark in one statement.
      const [row] = await db.execute(sql`
        select
          (select case when is_called then last_value else 0 end
            from public.manual_match_cache_revision_seq) as revision,
          (select count(*) from public.manual_match_cache_outbox
            where delivered_at is null) as pending_revisions
      `);
      return {
        revision: Number(row?.revision ?? 0),
        pendingRevisions: Number(row?.pending_revisions ?? 0),
      };
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async getManualMatch(id: string): Promise<PublishedManualMatchRow | null> {
    try {
      const [row] = await getDatabase().select().from(publishedManualMatches)
        .where(eq(publishedManualMatches.id, id)).limit(1);
      return row ?? null;
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async createManualMatch(
    input: PublishedMatchWrite,
    actorId: string,
    fence: ManualMatchCacheFence = noCacheFence,
    operationKey: string | null = null,
  ): Promise<PublishedManualMatchRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        await lockManualMatchMutations(tx);
        if (operationKey) {
          const [existing] = await tx.select().from(publishedManualMatches)
            .where(eq(publishedManualMatches.operationKey, operationKey)).limit(1);
          if (existing) return existing;
        }
        const [row] = await tx.insert(publishedManualMatches).values({
          ...publishedValues(input),
          publishedBy: actorId,
          operationKey,
        }).returning();
        await tx.insert(adminAuditEvents).values({
          actorId,
          action: "manual_match.created",
          entityType: "published_manual_match",
          entityId: row.id,
          afterJson: auditMatch(row),
        });
        await createManualMatchCacheRevision(tx, fence);
        return row;
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async updateManualMatch(
    id: string,
    input: PublishedMatchWrite,
    actorId: string,
    expectedUpdatedAt: Date,
    fence: ManualMatchCacheFence = noCacheFence,
  ): Promise<PublishedManualMatchRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        await lockManualMatchMutations(tx);
        const [before] = await tx.select().from(publishedManualMatches)
          .where(eq(publishedManualMatches.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("人工比赛不存在。");
        assertExpectedVersion(before.updatedAt, expectedUpdatedAt);
        const updatedAt = nextUpdatedAt(before.updatedAt);
        const [after] = await tx.update(publishedManualMatches)
          .set(publishedValues(input, updatedAt))
          .where(and(
            eq(publishedManualMatches.id, id),
            eq(publishedManualMatches.updatedAt, expectedUpdatedAt),
          )).returning();
        if (!after) throw new ReviewConflictError("记录已经被其他管理员修改，请重新加载后再操作。");
        await tx.insert(adminAuditEvents).values({
          actorId,
          action: "manual_match.updated",
          entityType: "published_manual_match",
          entityId: id,
          beforeJson: auditMatch(before),
          afterJson: auditMatch(after),
        });
        await createManualMatchCacheRevision(tx, fence);
        return after;
      });
    } catch (error) {
      if (error instanceof ReviewNotFoundError || error instanceof ReviewConflictError) throw error;
      translateDatabaseError(error);
    }
  }

  async setManualMatchHidden(
    id: string,
    hidden: boolean,
    actorId: string,
    expectedUpdatedAt: Date,
    fence: ManualMatchCacheFence = noCacheFence,
  ): Promise<PublishedManualMatchRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        await lockManualMatchMutations(tx);
        const [before] = await tx.select().from(publishedManualMatches)
          .where(eq(publishedManualMatches.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("人工比赛不存在。");
        assertExpectedVersion(before.updatedAt, expectedUpdatedAt);
        const updatedAt = nextUpdatedAt(before.updatedAt);
        const [after] = await tx.update(publishedManualMatches)
          .set({ hidden, updatedAt })
          .where(and(
            eq(publishedManualMatches.id, id),
            eq(publishedManualMatches.updatedAt, expectedUpdatedAt),
          )).returning();
        if (!after) throw new ReviewConflictError("记录已经被其他管理员修改，请重新加载后再操作。");
        await tx.insert(adminAuditEvents).values({
          actorId,
          action: hidden ? "manual_match.hidden" : "manual_match.restored",
          entityType: "published_manual_match",
          entityId: id,
          beforeJson: auditMatch(before),
          afterJson: auditMatch(after),
        });
        await createManualMatchCacheRevision(tx, fence);
        return after;
      });
    } catch (error) {
      if (error instanceof ReviewNotFoundError || error instanceof ReviewConflictError) throw error;
      translateDatabaseError(error);
    }
  }

  async toggleManualMatchHidden(
    id: string,
    actorId: string,
    expectedUpdatedAt: Date,
    fence: ManualMatchCacheFence = noCacheFence,
  ): Promise<PublishedManualMatchRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        await lockManualMatchMutations(tx);
        const [before] = await tx.select().from(publishedManualMatches)
          .where(eq(publishedManualMatches.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("人工比赛不存在。");
        assertExpectedVersion(before.updatedAt, expectedUpdatedAt);
        const hidden = !before.hidden;
        const updatedAt = nextUpdatedAt(before.updatedAt);
        const [after] = await tx.update(publishedManualMatches)
          .set({ hidden, updatedAt })
          .where(and(
            eq(publishedManualMatches.id, id),
            eq(publishedManualMatches.updatedAt, expectedUpdatedAt),
          )).returning();
        if (!after) throw new ReviewConflictError("记录已经被其他管理员修改，请重新加载后再操作。");
        await tx.insert(adminAuditEvents).values({
          actorId,
          action: hidden ? "manual_match.hidden" : "manual_match.restored",
          entityType: "published_manual_match",
          entityId: id,
          beforeJson: auditMatch(before),
          afterJson: auditMatch(after),
        });
        await createManualMatchCacheRevision(tx, fence);
        return after;
      });
    } catch (error) {
      if (error instanceof ReviewNotFoundError || error instanceof ReviewConflictError) throw error;
      translateDatabaseError(error);
    }
  }

  async auditLegacyImport(actorId: string, counts: Record<string, number>): Promise<void> {
    try {
      await getDatabase().insert(adminAuditEvents).values({
        actorId,
        action: "legacy_submissions.imported",
        entityType: "legacy_import",
        entityId: crypto.randomUUID(),
        afterJson: counts,
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async ping(): Promise<void> {
    try {
      await getDatabase().execute(sql`select 1`);
    } catch (error) {
      translateDatabaseError(error);
    }
  }
}

let defaultRepository: DrizzleReviewRepository | null = null;

export function getReviewRepository(): DrizzleReviewRepository {
  defaultRepository ??= new DrizzleReviewRepository();
  return defaultRepository;
}
