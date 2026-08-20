import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DrizzleReviewRepository } from "./repository";
import type { MatchSubmissionInput } from "@/lib/submissions";
import type { PublishedMatchWrite } from "./types";

const testUrl = process.env.REVIEW_TEST_DATABASE_URL?.trim();
const enabled = process.env.ALLOW_REVIEW_DATABASE_TESTS === "1" && !!testUrl;

describe.skipIf(!enabled)("review repository transactions (isolated PostgreSQL)", () => {
  let repository: DrizzleReviewRepository;
  let cleanup: ReturnType<typeof postgres>;
  const submissionIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    ({ DrizzleReviewRepository: repository } = {
      DrizzleReviewRepository: new (await import("./repository")).DrizzleReviewRepository(),
    });
    cleanup = postgres(testUrl!, { max: 1, prepare: false });
  });

  afterAll(async () => {
    if (!cleanup) return;
    if (submissionIds.length > 0) {
      await cleanup`delete from published_manual_matches where source_submission_id = any(${submissionIds}::uuid[])`;
      await cleanup`delete from admin_audit_events where entity_id = any(${submissionIds}::uuid[])`;
      await cleanup`delete from match_submissions where id = any(${submissionIds}::uuid[])`;
    }
    await cleanup.end();
  });

  function submission(suffix: string): MatchSubmissionInput {
    return {
      game: "lol",
      league: `Integration ${suffix}`,
      teamA: `Alpha ${suffix}`,
      teamB: `Beta ${suffix}`,
      scheduledAt: "2026-08-01T00:00:00.000Z",
      bestOf: 3,
      sourceUrl: "https://example.com/integration",
      notes: null,
    };
  }

  function published(input: MatchSubmissionInput): PublishedMatchWrite {
    return {
      game: input.game,
      league: input.league,
      tournament: null,
      stage: null,
      homeTeamName: input.teamA,
      homeTeamAcronym: null,
      homeTeamLogo: null,
      awayTeamName: input.teamB,
      awayTeamAcronym: null,
      awayTeamLogo: null,
      startTimeUtc: input.scheduledAt,
      bestOf: input.bestOf,
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      streamUrl: null,
      sourceUrl: input.sourceUrl,
    };
  }

  async function create(suffix: string) {
    const id = randomUUID();
    submissionIds.push(id);
    const input = submission(suffix);
    await repository.createSubmission(input, { id });
    return { id, input };
  }

  it("allows only one winner when two administrators approve concurrently", async () => {
    const { id, input } = await create(`race-${randomUUID()}`);
    const results = await Promise.allSettled([
      repository.approveSubmission(id, { submission: input, published: published(input) }, "admin-a"),
      repository.approveSubmission(id, { submission: input, published: published(input) }, "admin-b"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.listManualMatches()).rows.filter(
      (row) => row.sourceSubmissionId === id,
    )).toHaveLength(1);
  });

  it("rolls back the published insert and submission update when approval fails", async () => {
    const { id, input } = await create(`rollback-${randomUUID()}`);
    await expect(repository.approveSubmission(id, {
      submission: input,
      published: { ...published(input), status: "invalid" as PublishedMatchWrite["status"] },
    }, "admin-a")).rejects.toThrow();
    expect((await repository.getSubmission(id))?.status).toBe("pending");
    expect((await repository.listManualMatches()).rows.some(
      (row) => row.sourceSubmissionId === id,
    )).toBe(false);
  });

  it("rejects without publishing and can hide then restore a published match", async () => {
    const rejected = await create(`reject-${randomUUID()}`);
    await repository.rejectSubmission(rejected.id, "not verifiable", "admin-a");
    expect((await repository.getSubmission(rejected.id))?.status).toBe("rejected");
    expect((await repository.listManualMatches()).rows.some(
      (row) => row.sourceSubmissionId === rejected.id,
    )).toBe(false);

    const approved = await create(`visibility-${randomUUID()}`);
    const match = await repository.approveSubmission(approved.id, {
      submission: approved.input,
      published: published(approved.input),
    }, "admin-a");
    expect((await repository.setManualMatchHidden(match.id, true, "admin-a")).hidden).toBe(true);
    expect((await repository.toggleManualMatchHidden(match.id, "admin-a")).hidden).toBe(false);
    expect((await repository.toggleManualMatchHidden(match.id, "admin-a")).hidden).toBe(true);
  });
});
