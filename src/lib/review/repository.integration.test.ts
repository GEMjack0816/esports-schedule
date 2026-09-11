import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DrizzleReviewRepository } from "./repository";
import type { MatchSubmissionInput } from "@/lib/submissions";
import {
  PUBLIC_SUBMISSION_GATE_LOCK,
  submissionControlWindowKey,
} from "./submission-protection";
import type { PublicSubmissionPolicy, SubmissionControlWindowKind } from "./submission-protection";
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

type PublicSubmissionResult = Awaited<ReturnType<DrizzleReviewRepository["createPublicSubmission"]>>;

const testUrl = process.env.REVIEW_TEST_DATABASE_URL?.trim();
const enabled = process.env.ALLOW_REVIEW_DATABASE_TESTS === "1" && !!testUrl;

describe.skipIf(!enabled)("review repository transactions (isolated PostgreSQL)", () => {
  let repository: DrizzleReviewRepository;
  let cleanup: ReturnType<typeof postgres>;
  const submissionIds: string[] = [];
  const manualMatchIds: string[] = [];
  const rateLimitSources: string[] = [];
  const rateLimitWindowKeys: string[] = [];

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
    if (rateLimitWindowKeys.length > 0) {
      await cleanup`delete from submission_rate_limit_windows where window_key = any(${rateLimitWindowKeys}::text[])`;
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
    const value: PublicSubmissionPolicy = {
      maxPerSource: 5,
      windowMs: 60_000,
      maxGlobalRequests: 10_000,
      maxNewSources: 10_000,
      maxPending: 10_000,
      queueRetryAfterSeconds: 300,
      busyRetryAfterSeconds: 1,
      gateLockMaxWaitMs: 1_000,
      gateLockRetryMs: 10,
      statementTimeoutMs: 5_000,
      rowLockTimeoutMs: 500,
      cleanupIntervalMs: 60 * 60 * 1_000,
      sourceRetentionMs: 60 * 60 * 1_000,
      cleanupBatchSize: 20,
      counterNamespace: `test-${randomUUID()}`,
      ...overrides,
    };
    for (const kind of ["global-requests", "new-sources", "cleanup"] satisfies SubmissionControlWindowKind[]) {
      rateLimitWindowKeys.push(submissionControlWindowKey(value.counterNamespace, kind));
    }
    return value;
  }

  function rememberCreated(results: PublicSubmissionResult[]) {
    for (const result of results) {
      if (result.kind === "created") submissionIds.push(result.submission.id);
    }
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
    const limiterPolicy = policy({ maxPerSource: 2 });
    const results = await Promise.all([
      repository.createPublicSubmission(submission(`limit-a-${randomUUID()}`), source, now, limiterPolicy),
      repository.createPublicSubmission(submission(`limit-b-${randomUUID()}`), source, now, limiterPolicy),
      repository.createPublicSubmission(submission(`limit-c-${randomUUID()}`), source, now, limiterPolicy),
    ]);
    rememberCreated(results);
    expect(results.filter((result) => result.kind === "created")).toHaveLength(2);
    expect(results.find((result) => result.kind === "source-rate-limited"))
      .toMatchObject({ kind: "source-rate-limited", retryAfterSeconds: 60 });
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
    rememberCreated(results);
    expect(results.filter((result) => result.kind === "created")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "queue-full")).toHaveLength(1);
    const [persisted] = await cleanup`
      select count(*)::int as value
      from submission_rate_limits
      where source_hash = any(${sources}::text[])
    `;
    expect(Number(persisted.value)).toBe(1);
  });

  it("bounds persistent limiter rows during a flood of unique sources", async () => {
    const floodPolicy = policy({ maxNewSources: 3, maxGlobalRequests: 100 });
    const sources = Array.from({ length: 7 }, () => `flood-${randomUUID()}`);
    rateLimitSources.push(...sources);
    const results: PublicSubmissionResult[] = [];
    for (const [index, source] of sources.entries()) {
      results.push(await repository.createPublicSubmission(
        submission(`source-flood-${index}-${randomUUID()}`),
        source,
        new Date("2026-08-21T00:00:00.000Z"),
        floodPolicy,
      ));
    }
    rememberCreated(results);
    expect(results.filter((result) => result.kind === "created")).toHaveLength(3);
    expect(results.filter((result) => result.kind === "new-source-rate-limited")).toHaveLength(4);
    const [persisted] = await cleanup`
      select count(*)::int as value
      from submission_rate_limits
      where source_hash = any(${sources}::text[])
    `;
    expect(Number(persisted.value)).toBe(3);
  });

  it("does not create source limiter state when the pending queue is already full", async () => {
    const baseline = (await repository.getSubmissionCounts()).pending;
    const source = `queue-full-${randomUUID()}`;
    rateLimitSources.push(source);
    const result = await repository.createPublicSubmission(
      submission(`queue-full-${randomUUID()}`),
      source,
      new Date(),
      policy({ maxPending: baseline }),
    );
    expect(result.kind).toBe("queue-full");
    const [persisted] = await cleanup`
      select count(*)::int as value from submission_rate_limits where source_hash = ${source}
    `;
    expect(Number(persisted.value)).toBe(0);
  });

  it("does not grow source limiter state during a duplicate flood", async () => {
    const duplicate = await create(`duplicate-flood-${randomUUID()}`);
    const duplicatePolicy = policy({ maxGlobalRequests: 100, maxNewSources: 2 });
    const sources = Array.from({ length: 20 }, () => `duplicate-${randomUUID()}`);
    rateLimitSources.push(...sources);
    const results: PublicSubmissionResult[] = [];
    for (const source of sources) {
      results.push(await repository.createPublicSubmission(
        duplicate.input,
        source,
        new Date("2026-08-22T00:00:00.000Z"),
        duplicatePolicy,
      ));
    }
    expect(results.every((result) => result.kind === "duplicate")).toBe(true);
    const [persisted] = await cleanup`
      select count(*)::int as value
      from submission_rate_limits
      where source_hash = any(${sources}::text[])
    `;
    expect(Number(persisted.value)).toBe(0);
  });

  it("enforces a fixed-key global request window across many sources", async () => {
    const globalPolicy = policy({ maxGlobalRequests: 3, maxNewSources: 100 });
    const sources = Array.from({ length: 4 }, () => `global-${randomUUID()}`);
    rateLimitSources.push(...sources);
    const results: PublicSubmissionResult[] = [];
    for (const [index, source] of sources.entries()) {
      results.push(await repository.createPublicSubmission(
        submission(`global-${index}-${randomUUID()}`),
        source,
        new Date("2026-08-23T00:00:00.000Z"),
        globalPolicy,
      ));
    }
    rememberCreated(results);
    expect(results.filter((result) => result.kind === "created")).toHaveLength(3);
    expect(results[3]).toMatchObject({ kind: "global-rate-limited", retryAfterSeconds: 60 });
  });

  it("does not exceed the global limit under concurrent multi-source requests", async () => {
    const globalPolicy = policy({
      maxGlobalRequests: 4,
      maxNewSources: 100,
      gateLockMaxWaitMs: 2_000,
    });
    const sources = Array.from({ length: 12 }, () => `global-race-${randomUUID()}`);
    rateLimitSources.push(...sources);
    const results = await Promise.all(sources.map((source, index) => repository.createPublicSubmission(
      submission(`global-race-${index}-${randomUUID()}`),
      source,
      new Date("2026-08-24T00:00:00.000Z"),
      globalPolicy,
    )));
    rememberCreated(results);
    expect(results.filter((result) => result.kind === "created")).toHaveLength(4);
    expect(results.filter((result) => result.kind === "global-rate-limited")).toHaveLength(8);
    const globalKey = submissionControlWindowKey(globalPolicy.counterNamespace, "global-requests");
    const [counter] = await cleanup`
      select request_count from submission_rate_limit_windows where window_key = ${globalKey}
    `;
    expect(Number(counter.request_count)).toBe(4);
  });

  it("deletes only a bounded batch of expired source rows and preserves active rows", async () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    const cleanupPolicy = policy({
      maxPending: (await repository.getSubmissionCounts()).pending,
      cleanupIntervalMs: 1,
      sourceRetentionMs: 60 * 60 * 1_000,
      cleanupBatchSize: 2,
    });
    const expiredSources = Array.from({ length: 3 }, () => `expired-${randomUUID()}`);
    const activeSources = Array.from({ length: 2 }, () => `active-${randomUUID()}`);
    const candidateSource = `cleanup-candidate-${randomUUID()}`;
    rateLimitSources.push(...expiredSources, ...activeSources, candidateSource);
    for (const source of expiredSources) {
      await cleanup`
        insert into submission_rate_limits (source_hash, window_started_at, request_count, updated_at)
        values (${source}, ${new Date("2000-01-01T00:00:00.000Z")}, 1, ${new Date("2000-01-01T00:00:00.000Z")})
      `;
    }
    for (const source of activeSources) {
      await cleanup`
        insert into submission_rate_limits (source_hash, window_started_at, request_count, updated_at)
        values (${source}, ${new Date("2029-12-31T23:30:00.000Z")}, 1, ${new Date("2029-12-31T23:30:00.000Z")})
      `;
    }
    const cleanupKey = submissionControlWindowKey(cleanupPolicy.counterNamespace, "cleanup");
    await cleanup`
      insert into submission_rate_limit_windows (window_key, window_started_at, request_count, updated_at)
      values (${cleanupKey}, ${new Date("2000-01-01T00:00:00.000Z")}, 0, ${new Date("2000-01-01T00:00:00.000Z")})
      on conflict (window_key) do update set updated_at = excluded.updated_at
    `;

    const result = await repository.createPublicSubmission(
      submission(`cleanup-${randomUUID()}`),
      candidateSource,
      now,
      cleanupPolicy,
    );
    expect(result.kind).toBe("queue-full");
    const [expired] = await cleanup`
      select count(*)::int as value
      from submission_rate_limits
      where source_hash = any(${expiredSources}::text[])
    `;
    const [active] = await cleanup`
      select count(*)::int as value
      from submission_rate_limits
      where source_hash = any(${activeSources}::text[])
    `;
    const [candidate] = await cleanup`
      select count(*)::int as value from submission_rate_limits where source_hash = ${candidateSource}
    `;
    expect(Number(expired.value)).toBe(1);
    expect(Number(active.value)).toBe(2);
    expect(Number(candidate.value)).toBe(0);
  });

  it("returns service-busy within a bounded time when the advisory gate is held", async () => {
    const source = `lock-contention-${randomUUID()}`;
    rateLimitSources.push(source);
    const lockPolicy = policy({ gateLockMaxWaitMs: 100, gateLockRetryMs: 10 });
    await cleanup`select pg_advisory_lock(${PUBLIC_SUBMISSION_GATE_LOCK})`;
    try {
      const startedAt = Date.now();
      const result = await repository.createPublicSubmission(
        submission(`lock-contention-${randomUUID()}`),
        source,
        new Date(),
        lockPolicy,
      );
      expect(result).toMatchObject({ kind: "service-busy", retryAfterSeconds: 1 });
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      await cleanup`select pg_advisory_unlock(${PUBLIC_SUBMISSION_GATE_LOCK})`;
    }
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

  it("atomically removes only records belonging to one isolated verification run", async () => {
    const league = `Codex isolated review ${randomUUID()}`;
    const approvedId = randomUUID();
    const rejectedId = randomUUID();
    submissionIds.push(approvedId, rejectedId);
    const approvedInput = { ...submission("verify-approved"), league };
    const rejectedInput = { ...submission("verify-rejected"), league };
    const approvedRow = await repository.createSubmission(approvedInput, { id: approvedId });
    const rejectedRow = await repository.createSubmission(rejectedInput, { id: rejectedId });
    const publishedRow = await repository.approveSubmission(
      approvedId,
      { submission: approvedInput, published: published(approvedInput) },
      "admin-a",
      approvedRow.updatedAt,
    );
    manualMatchIds.push(publishedRow.id);
    await repository.rejectSubmission(rejectedId, "verification", "admin-a", rejectedRow.updatedAt);

    const deleted = await repository.cleanupIsolatedVerificationRun(
      [approvedId, rejectedId],
      league,
    );
    expect(deleted.submissions).toBe(2);
    expect(deleted.manualMatches).toBe(1);
    expect(deleted.auditEvents).toBeGreaterThanOrEqual(2);
    const [remainingSubmissions] = await cleanup`
      select count(*)::int as count from match_submissions
      where id = any(${[approvedId, rejectedId]}::uuid[])
    `;
    const [remainingMatches] = await cleanup`
      select count(*)::int as count from published_manual_matches
      where id = ${publishedRow.id}
    `;
    expect(remainingSubmissions.count).toBe(0);
    expect(remainingMatches.count).toBe(0);
  });

  it("commits legacy imports and their summary audit in one transaction", async () => {
    const firstId = randomUUID();
    const duplicateId = randomUUID();
    const actorId = `legacy-atomic-${randomUUID()}`;
    submissionIds.push(firstId, duplicateId);
    const duplicateInput = submission(`legacy-existing-${randomUUID()}`);
    await repository.createSubmission(duplicateInput, { id: duplicateId });

    const counts = await repository.importLegacySubmissions([
      {
        id: firstId,
        input: submission(`legacy-new-${randomUUID()}`),
        submittedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        id: duplicateId,
        input: duplicateInput,
        submittedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ], actorId, { scanned: 3, imported: 0, duplicate: 0, invalid: 1 });

    expect(counts).toEqual({ scanned: 3, imported: 1, duplicate: 1, invalid: 1 });
    const [audit] = await cleanup`
      select after_json from admin_audit_events
      where actor_id = ${actorId} and action = 'legacy_submissions.imported'
    `;
    expect(audit.after_json).toEqual(counts);
    await cleanup`delete from admin_audit_events where actor_id = ${actorId}`;
  });

  it("rolls back earlier legacy inserts when a later insert fails", async () => {
    const firstId = randomUUID();
    const invalidId = randomUUID();
    const actorId = `legacy-rollback-${randomUUID()}`;
    submissionIds.push(firstId, invalidId);
    const validInput = submission(`legacy-rollback-${randomUUID()}`);
    const invalidInput = { ...submission(`legacy-invalid-${randomUUID()}`), teamB: "Same" };
    invalidInput.teamA = "Same";

    await expect(repository.importLegacySubmissions([
      { id: firstId, input: validInput, submittedAt: new Date() },
      { id: invalidId, input: invalidInput, submittedAt: new Date() },
    ], actorId, { scanned: 2, imported: 0, duplicate: 0, invalid: 0 })).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });

    const [inserted] = await cleanup`
      select count(*)::int as count from match_submissions where id = ${firstId}
    `;
    const [audit] = await cleanup`
      select count(*)::int as count from admin_audit_events where actor_id = ${actorId}
    `;
    expect(inserted.count).toBe(0);
    expect(audit.count).toBe(0);
  });
});
