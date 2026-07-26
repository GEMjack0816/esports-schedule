import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDatabase, safeDatabaseErrorCode } from "@/db";
import {
  adminAuditEvents,
  matchSubmissions,
  publishedManualMatches,
} from "@/db/schema";
import type {
  MatchSubmissionRow,
  PublishedManualMatchRow,
} from "@/db/schema";
import type { MatchSubmissionInput } from "@/lib/submissions";
import { createSubmissionFingerprint } from "@/lib/submissions";
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
  PublishedMatchWrite,
  SubmissionCounts,
  SubmissionListFilters,
  SubmissionPage,
} from "./types";

type CreateOptions = {
  id?: string;
  submittedAt?: Date;
};

function submissionValues(input: MatchSubmissionInput) {
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
    updatedAt: new Date(),
  };
}

function publishedValues(input: PublishedMatchWrite) {
  return {
    ...input,
    startTimeUtc: input.startTimeUtc ? new Date(input.startTimeUtc) : null,
    updatedAt: new Date(),
  };
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
  ): Promise<MatchSubmissionRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        const [before] = await tx.select().from(matchSubmissions)
          .where(eq(matchSubmissions.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("提交不存在。");
        if (before.status !== "pending") throw new ReviewConflictError("仅待审核提交可以编辑。");
        const [after] = await tx.update(matchSubmissions)
          .set(submissionValues(input))
          .where(and(eq(matchSubmissions.id, id), eq(matchSubmissions.status, "pending")))
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

  async approveSubmission(id: string, input: ApprovalInput, actorId: string): Promise<PublishedManualMatchRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        const [before] = await tx.select().from(matchSubmissions)
          .where(eq(matchSubmissions.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("提交不存在。");
        if (before.status !== "pending") throw new ReviewConflictError("提交已被审核。");

        const [published] = await tx.insert(publishedManualMatches).values({
          ...publishedValues(input.published),
          sourceSubmissionId: id,
          publishedBy: actorId,
        }).returning();

        const now = new Date();
        const [approved] = await tx.update(matchSubmissions)
          .set({
            ...submissionValues(input.submission),
            status: "approved",
            reviewedAt: now,
            reviewedBy: actorId,
            rejectionReason: null,
            publishedMatchId: published.id,
          })
          .where(and(eq(matchSubmissions.id, id), eq(matchSubmissions.status, "pending")))
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
        return published;
      });
    } catch (error) {
      if (error instanceof ReviewNotFoundError || error instanceof ReviewConflictError) throw error;
      translateDatabaseError(error);
    }
  }

  async rejectSubmission(id: string, reason: string, actorId: string): Promise<MatchSubmissionRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        const [before] = await tx.select().from(matchSubmissions)
          .where(eq(matchSubmissions.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("提交不存在。");
        if (before.status !== "pending") throw new ReviewConflictError("提交已被审核。");
        const [after] = await tx.update(matchSubmissions).set({
          status: "rejected",
          reviewedAt: new Date(),
          reviewedBy: actorId,
          rejectionReason: reason,
          updatedAt: new Date(),
        }).where(and(eq(matchSubmissions.id, id), eq(matchSubmissions.status, "pending"))).returning();
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

  async getManualMatch(id: string): Promise<PublishedManualMatchRow | null> {
    try {
      const [row] = await getDatabase().select().from(publishedManualMatches)
        .where(eq(publishedManualMatches.id, id)).limit(1);
      return row ?? null;
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async createManualMatch(input: PublishedMatchWrite, actorId: string): Promise<PublishedManualMatchRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        const [row] = await tx.insert(publishedManualMatches).values({
          ...publishedValues(input),
          publishedBy: actorId,
        }).returning();
        await tx.insert(adminAuditEvents).values({
          actorId,
          action: "manual_match.created",
          entityType: "published_manual_match",
          entityId: row.id,
          afterJson: auditMatch(row),
        });
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
  ): Promise<PublishedManualMatchRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        const [before] = await tx.select().from(publishedManualMatches)
          .where(eq(publishedManualMatches.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("人工比赛不存在。");
        const [after] = await tx.update(publishedManualMatches)
          .set(publishedValues(input))
          .where(eq(publishedManualMatches.id, id)).returning();
        await tx.insert(adminAuditEvents).values({
          actorId,
          action: "manual_match.updated",
          entityType: "published_manual_match",
          entityId: id,
          beforeJson: auditMatch(before),
          afterJson: auditMatch(after),
        });
        return after;
      });
    } catch (error) {
      if (error instanceof ReviewNotFoundError) throw error;
      translateDatabaseError(error);
    }
  }

  async setManualMatchHidden(id: string, hidden: boolean, actorId: string): Promise<PublishedManualMatchRow> {
    try {
      return await getDatabase().transaction(async (tx) => {
        const [before] = await tx.select().from(publishedManualMatches)
          .where(eq(publishedManualMatches.id, id)).for("update");
        if (!before) throw new ReviewNotFoundError("人工比赛不存在。");
        const [after] = await tx.update(publishedManualMatches)
          .set({ hidden, updatedAt: new Date() })
          .where(eq(publishedManualMatches.id, id)).returning();
        await tx.insert(adminAuditEvents).values({
          actorId,
          action: hidden ? "manual_match.hidden" : "manual_match.restored",
          entityType: "published_manual_match",
          entityId: id,
          beforeJson: auditMatch(before),
          afterJson: auditMatch(after),
        });
        return after;
      });
    } catch (error) {
      if (error instanceof ReviewNotFoundError) throw error;
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
