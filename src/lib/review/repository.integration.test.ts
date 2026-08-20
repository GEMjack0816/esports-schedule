import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DrizzleReviewRepository } from "./repository";
import type { MatchSubmissionInput } from "@/lib/submissions";
import type { PublicSubmissionPolicy } from "./submission-protection";
import type { PublishedMatchWrite } from "./types";
import {
  preserveLastSuccessfulPublicMatches,
  synchronizePublishedManualMatchesSnapshot,
} from "./public-matches";
import type { CachedPublicMatches } from "./public-matches";
import {
  approveAndPublish,
  toggleManualMatchHidden as toggleManualMatchHiddenService,
  updateManualMatch as updateManualMatchService,
} from "./service";
import type { PublishedManualCacheEffects } from "./service";

const testUrl = process.env.REVIEW_TEST_DATABASE_URL?.trim();
const enabled = process.env.ALLOW_REVIEW_DATABASE_TESTS === "1" && !!testUrl;

describe.skipIf(!enabled)("review repository transactions (isolated PostgreSQL)", () => {
  let repository: DrizzleReviewRepository;
  let cleanup: ReturnType<typeof postgres>;
  const submissionIds: string[] = [];
  const manualMatchIds: string[] = [];
  const rateLimitSources: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    ({ DrizzleReviewRepository: repository } = {
      DrizzleReviewRepository: new (await import("./repository")).DrizzleReviewRepository(),
    });
    cleanup = postgres(testUrl!, { max: 1, prepare: false });
  });

  afterAll(async () => {
    if (!cleanup) return;
    const auditEntityIds = [...submissionIds, ...manualMatchIds];
    if (submissionIds.length > 0) {
      await cleanup`delete from published_manual_matches where source_submission_id = any(${submissionIds}::uuid[])`;
    }
    if (manualMatchIds.length > 0) {
      await cleanup`delete from published_manual_matches where id = any(${manualMatchIds}::uuid[])`;
    }
    if (auditEntityIds.length > 0) {
      await cleanup`delete from admin_audit_events where entity_id = any(${auditEntityIds}::uuid[])`;
    }
    if (submissionIds.length > 0) {
      await cleanup`delete from match_submissions where id = any(${submissionIds}::uuid[])`;
    }
    if (rateLimitSources.length > 0) {
      await cleanup`delete from submission_rate_limits where source_hash = any(${rateLimitSources}::text[])`;
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
    const row = await repository.createSubmission(input, { id });
    return { id, input, row };
  }

  function policy(overrides: Partial<PublicSubmissionPolicy> = {}): PublicSubmissionPolicy {
    return {
      maxPerSource: 5,
      windowMs: 60_000,
      maxPending: 10_000,
      queueRetryAfterSeconds: 300,
      ...overrides,
    };
  }

  function snapshotEffects(holder: { value: CachedPublicMatches | null }): PublishedManualCacheEffects {
    return {
      synchronize: (currentRepository) => synchronizePublishedManualMatchesSnapshot(
        currentRepository,
        async (value) => {
          holder.value = value;
        },
      ),
      invalidate: () => undefined,
    };
  }

  async function matchesDuringDatabaseOutage(holder: { value: CachedPublicMatches | null }) {
    const result = await preserveLastSuccessfulPublicMatches(
      async () => {
        throw new Error("database unavailable");
      },
      async () => holder.value,
    );
    return result.value?.matches ?? [];
  }

  it("allows only one winner when two administrators approve concurrently", async () => {
    const { id, input, row } = await create(`race-${randomUUID()}`);
    const results = await Promise.allSettled([
      repository.approveSubmission(id, { submission: input, published: published(input) }, "admin-a", row.updatedAt),
      repository.approveSubmission(id, { submission: input, published: published(input) }, "admin-b", row.updatedAt),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.listManualMatches()).rows.filter(
      (match) => match.sourceSubmissionId === id,
    )).toHaveLength(1);
  });

  it("rolls back the published insert and submission update when approval fails", async () => {
    const { id, input, row } = await create(`rollback-${randomUUID()}`);
    await expect(repository.approveSubmission(id, {
      submission: input,
      published: { ...published(input), status: "invalid" as PublishedMatchWrite["status"] },
    }, "admin-a", row.updatedAt)).rejects.toThrow();
    expect((await repository.getSubmission(id))?.status).toBe("pending");
    expect((await repository.listManualMatches()).rows.some(
      (match) => match.sourceSubmissionId === id,
    )).toBe(false);
  });

  it("rejects without publishing and can hide then restore a published match", async () => {
    const rejected = await create(`reject-${randomUUID()}`);
    await repository.rejectSubmission(rejected.id, "not verifiable", "admin-a", rejected.row.updatedAt);
    expect((await repository.getSubmission(rejected.id))?.status).toBe("rejected");
    expect((await repository.listManualMatches()).rows.some(
      (match) => match.sourceSubmissionId === rejected.id,
    )).toBe(false);

    const approved = await create(`visibility-${randomUUID()}`);
    const match = await repository.approveSubmission(approved.id, {
      submission: approved.input,
      published: published(approved.input),
    }, "admin-a", approved.row.updatedAt);
    const hidden = await repository.setManualMatchHidden(match.id, true, "admin-a", match.updatedAt);
    const restored = await repository.toggleManualMatchHidden(match.id, "admin-a", hidden.updatedAt);
    expect(restored.hidden).toBe(false);
    expect((await repository.toggleManualMatchHidden(match.id, "admin-a", restored.updatedAt)).hidden).toBe(true);
  });

  it("atomically limits concurrent submissions from one source", async () => {
    const source = `source-${randomUUID()}`;
    rateLimitSources.push(source);
    const now = new Date("2026-08-20T00:00:00.000Z");
    const results = await Promise.all([
      repository.createPublicSubmission(submission(`limit-a-${randomUUID()}`), source, now, policy({ maxPerSource: 2 })),
      repository.createPublicSubmission(submission(`limit-b-${randomUUID()}`), source, now, policy({ maxPerSource: 2 })),
      repository.createPublicSubmission(submission(`limit-c-${randomUUID()}`), source, now, policy({ maxPerSource: 2 })),
    ]);
    for (const result of results) {
      if (result.kind === "created") submissionIds.push(result.submission.id);
    }
    expect(results.filter((result) => result.kind === "created")).toHaveLength(2);
    expect(results.find((result) => result.kind === "rate-limited"))
      .toMatchObject({ kind: "rate-limited", retryAfterSeconds: 60 });
  });

  it("atomically admits only one concurrent submission when the pending queue has one slot", async () => {
    const baseline = (await repository.getSubmissionCounts()).pending;
    const sources = [`source-${randomUUID()}`, `source-${randomUUID()}`];
    rateLimitSources.push(...sources);
    const queuePolicy = policy({ maxPending: baseline + 1 });
    const results = await Promise.all([
      repository.createPublicSubmission(submission(`queue-a-${randomUUID()}`), sources[0], new Date(), queuePolicy),
      repository.createPublicSubmission(submission(`queue-b-${randomUUID()}`), sources[1], new Date(), queuePolicy),
    ]);
    for (const result of results) {
      if (result.kind === "created") submissionIds.push(result.submission.id);
    }
    expect(results.filter((result) => result.kind === "created")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "queue-full")).toHaveLength(1);
  });

  it("prevents stale save/save and save/approve overwrites", async () => {
    const saveRace = await create(`save-save-${randomUUID()}`);
    const saveResults = await Promise.allSettled([
      repository.saveSubmission(saveRace.id, { ...saveRace.input, league: `${saveRace.input.league} A` }, "admin-a", saveRace.row.updatedAt),
      repository.saveSubmission(saveRace.id, { ...saveRace.input, league: `${saveRace.input.league} B` }, "admin-b", saveRace.row.updatedAt),
    ]);
    expect(saveResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(saveResults.filter((result) => result.status === "rejected")).toHaveLength(1);

    const approveRace = await create(`save-approve-${randomUUID()}`);
    const approveResults = await Promise.allSettled([
      repository.saveSubmission(
        approveRace.id,
        { ...approveRace.input, notes: "newer edit" },
        "admin-a",
        approveRace.row.updatedAt,
      ),
      repository.approveSubmission(
        approveRace.id,
        { submission: approveRace.input, published: published(approveRace.input) },
        "admin-b",
        approveRace.row.updatedAt,
      ),
    ]);
    expect(approveResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(approveResults.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("prevents stale edit/hide overwrites", async () => {
    const input = submission(`edit-hide-${randomUUID()}`);
    const match = await repository.createManualMatch(published(input), "admin-a");
    manualMatchIds.push(match.id);
    const results = await Promise.allSettled([
      repository.updateManualMatch(
        match.id,
        { ...published(input), league: `${input.league} edited` },
        "admin-a",
        match.updatedAt,
      ),
      repository.toggleManualMatchHidden(match.id, "admin-b", match.updatedAt),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("keeps the post-mutation Runtime Cache snapshot during an immediate database outage", async () => {
    const pending = await create(`snapshot-${randomUUID()}`);
    const holder: { value: CachedPublicMatches | null } = { value: null };
    const effects = snapshotEffects(holder);
    let match = await approveAndPublish(
      pending.id,
      { submission: pending.input, published: published(pending.input) },
      "admin-a",
      pending.row.updatedAt.toISOString(),
      repository,
      effects,
    );
    expect((await matchesDuringDatabaseOutage(holder)).some(
      (value) => value.providerMatchId === `db-${match.id}`,
    )).toBe(true);

    match = await updateManualMatchService(
      match.id,
      { ...published(pending.input), league: `${pending.input.league} edited` },
      "admin-a",
      match.updatedAt.toISOString(),
      repository,
      effects,
    );
    expect((await matchesDuringDatabaseOutage(holder)).find(
      (value) => value.providerMatchId === `db-${match.id}`,
    )?.league).toBe(`${pending.input.league} edited`);

    match = await toggleManualMatchHiddenService(
      match.id,
      "admin-a",
      match.updatedAt.toISOString(),
      repository,
      effects,
    );
    expect((await matchesDuringDatabaseOutage(holder)).some(
      (value) => value.providerMatchId === `db-${match.id}`,
    )).toBe(false);

    match = await toggleManualMatchHiddenService(
      match.id,
      "admin-a",
      match.updatedAt.toISOString(),
      repository,
      effects,
    );
    expect((await matchesDuringDatabaseOutage(holder)).find(
      (value) => value.providerMatchId === `db-${match.id}`,
    )?.league).toBe(`${pending.input.league} edited`);
  });
});
