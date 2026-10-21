import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MANUAL_MATCH_MUTATION_LOCK } from "./repository";
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
  selectRuntimeFallback,
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

  it("keeps a monotonic sequence watermark after an aborted fence and outbox cleanup", async () => {
    const before = await repository.getCurrentManualMatchRevision();
    const rolledBackInput = submission(`rolled-back revision ${randomUUID()}`);
    let externallyPublishedFence = 0;
    await expect(repository.createManualMatch(published(rolledBackInput), "admin-a", async (revision) => {
      // Model a Runtime Cache write that landed but whose acknowledgement was
      // lost, so the database transaction must roll back after the fence moved.
      externallyPublishedFence = revision;
      throw new Error("cache fence acknowledgement was lost");
    })).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    expect(externallyPublishedFence).toBeGreaterThan(before);
    expect(await repository.getCurrentManualMatchRevision()).toBe(externallyPublishedFence);

    const rolledBackSnapshot = await repository.readManualMatchCacheSnapshot();
    expect(rolledBackSnapshot.revision).toBe(externallyPublishedFence);
    expect(rolledBackSnapshot.rows.some((match) => match.league === rolledBackInput.league)).toBe(false);
    const staleFallback: CachedPublicMatches = {
      matches: [],
      fetchedAt: new Date().toISOString(),
      revision: before,
    };
    expect(selectRuntimeFallback(staleFallback, { revision: externallyPublishedFence })).toBeNull();
    let reconciledFallback: CachedPublicMatches | null = null;
    await synchronizePublishedManualMatchesSnapshot(repository, async (value) => {
      reconciledFallback = value;
    });
    expect(selectRuntimeFallback(
      reconciledFallback,
      { revision: externallyPublishedFence },
      externallyPublishedFence,
    )?.revision).toBe(externallyPublishedFence);

    const row = await repository.createManualMatch(published(submission("committed revision")), "admin-a");
    manualMatchIds.push(row.id);
    const created = await repository.getCurrentManualMatchRevision();
    expect(created).toBeGreaterThan(externallyPublishedFence);
    await repository.setManualMatchHidden(row.id, true, "admin-a", row.updatedAt);
    const hidden = await repository.getCurrentManualMatchRevision();
    expect(hidden).toBeGreaterThan(created);
    await repository.markManualMatchCacheDelivered(hidden);
    expect(await repository.getCurrentManualMatchRevision()).toBe(hidden);
    const snapshot = await repository.readManualMatchCacheSnapshot();
    expect(snapshot.revision).toBe(hidden);
    expect(snapshot.rows.some(match => match.id === row.id)).toBe(false);
  });

  it("does not publish a Runtime Cache fence when the business write fails before revision allocation", async () => {
    const before = await repository.getCurrentManualMatchRevision();
    const input = published(submission(`failed insert ${randomUUID()}`));
    input.homeScore = 32_768;
    const fence = vi.fn<(revision: number) => Promise<void>>().mockResolvedValue(undefined);

    await expect(repository.createManualMatch(input, "admin-a", fence)).rejects.toBeDefined();

    expect(fence).not.toHaveBeenCalled();
    expect(await repository.getCurrentManualMatchRevision()).toBe(before);
    const snapshot = await repository.readManualMatchCacheSnapshot();
    expect(snapshot.revision).toBe(before);
    expect(snapshot.rows.some((match) => match.league === input.league)).toBe(false);
  });

  it("restores an evicted cache fence from the database revision while holding the mutation lock", async () => {
    let fencedRevision = -1;
    let competingLockAcquired: boolean | undefined;
    const snapshot = await repository.readManualMatchCacheSnapshot(async (revision) => {
      fencedRevision = revision;
      const [row] = await cleanup`select pg_try_advisory_xact_lock(${MANUAL_MATCH_MUTATION_LOCK}) as acquired`;
      competingLockAcquired = row.acquired;
    });

    expect(snapshot.fenceWritten).toBe(true);
    expect(fencedRevision).toBe(snapshot.revision);
    expect(competingLockAcquired).toBe(false);
  });

  it("keeps the database snapshot readable when best-effort fence restoration fails", async () => {
    const snapshot = await repository.readManualMatchCacheSnapshot(async () => {
      throw new Error("runtime cache unavailable");
    });

    expect(snapshot.fenceWritten).toBe(false);
    expect(snapshot.revision).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(snapshot.rows)).toBe(true);
  });

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

  it("applies the source window to honeypot requests without creating submissions", async () => {
    const source = `honeypot-source-${randomUUID()}`;
    rateLimitSources.push(source);
    const now = new Date("2026-08-20T01:00:00.000Z");
    const limiterPolicy = policy({ maxPerSource: 1 });
    const [before] = await cleanup`select count(*)::int as value from match_submissions`;

    const first = await repository.consumePublicSubmissionHoneypot(source, now, limiterPolicy);
    const second = await repository.consumePublicSubmissionHoneypot(source, now, limiterPolicy);

    expect(first).toEqual({ kind: "honeypot" });
    expect(second).toMatchObject({ kind: "source-rate-limited", retryAfterSeconds: 60 });
    const [after] = await cleanup`select count(*)::int as value from match_submissions`;
    expect(Number(after.value)).toBe(Number(before.value));
  });

  it("shares the fixed global window between honeypot and normal submissions", async () => {
    const sources = Array.from({ length: 3 }, () => `honeypot-global-${randomUUID()}`);
    rateLimitSources.push(...sources);
    const now = new Date("2026-08-20T02:00:00.000Z");
    const limiterPolicy = policy({ maxGlobalRequests: 2, maxNewSources: 100 });

    const honeypot = await repository.consumePublicSubmissionHoneypot(
      sources[0],
      now,
      limiterPolicy,
    );
    const normal = await repository.createPublicSubmission(
      submission(`honeypot-global-${randomUUID()}`),
      sources[1],
      now,
      limiterPolicy,
    );
    const exhausted = await repository.consumePublicSubmissionHoneypot(
      sources[2],
      now,
      limiterPolicy,
    );

    expect(honeypot.kind).toBe("honeypot");
    expect(normal.kind).toBe("created");
    rememberCreated([normal]);
    expect(exhausted).toMatchObject({ kind: "global-rate-limited", retryAfterSeconds: 60 });
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

  it("bounds persistent limiter rows during a flood of unique honeypot sources", async () => {
    const floodPolicy = policy({ maxNewSources: 3, maxGlobalRequests: 100 });
    const sources = Array.from({ length: 7 }, () => `honeypot-flood-${randomUUID()}`);
    rateLimitSources.push(...sources);
    const results: PublicSubmissionResult[] = [];
    for (const source of sources) {
      results.push(await repository.consumePublicSubmissionHoneypot(
        source,
        new Date("2026-08-21T01:00:00.000Z"),
        floodPolicy,
      ));
    }
    expect(results.filter((result) => result.kind === "honeypot")).toHaveLength(3);
    expect(results.filter((result) => result.kind === "new-source-rate-limited")).toHaveLength(4);
    const [persisted] = await cleanup`
      select count(*)::int as value
      from submission_rate_limits
      where source_hash = any(${sources}::text[])
    `;
    expect(Number(persisted.value)).toBe(3);
  });

  it("does not exceed the global limit under concurrent mixed honeypot traffic", async () => {
    const globalPolicy = policy({
      maxGlobalRequests: 4,
      maxNewSources: 100,
      gateLockMaxWaitMs: 2_000,
    });
    const sources = Array.from({ length: 12 }, () => `honeypot-race-${randomUUID()}`);
    rateLimitSources.push(...sources);
    const results = await Promise.all(sources.map((source, index) => index % 2 === 0
      ? repository.consumePublicSubmissionHoneypot(
        source,
        new Date("2026-08-24T01:00:00.000Z"),
        globalPolicy,
      )
      : repository.createPublicSubmission(
        submission(`honeypot-race-${index}-${randomUUID()}`),
        source,
        new Date("2026-08-24T01:00:00.000Z"),
        globalPolicy,
      )));
    rememberCreated(results);
    expect(results.filter((result) => (
      result.kind === "created" || result.kind === "honeypot"
    ))).toHaveLength(4);
    expect(results.filter((result) => result.kind === "global-rate-limited")).toHaveLength(8);
    const globalKey = submissionControlWindowKey(globalPolicy.counterNamespace, "global-requests");
    const [counter] = await cleanup`
      select request_count from submission_rate_limit_windows where window_key = ${globalKey}
    `;
    expect(Number(counter.request_count)).toBe(4);
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

    await expect(repository.cleanupIsolatedVerificationRun(
      [approvedId, rejectedId], league,
      async () => { throw new Error("cache fence unavailable"); },
    )).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    expect(await repository.getManualMatch(publishedRow.id)).not.toBeNull();
    const fence = vi.fn<(revision: number) => Promise<void>>().mockResolvedValue(undefined);
    const deleted = await repository.cleanupIsolatedVerificationRun(
      [approvedId, rejectedId],
      league,
      fence,
    );
    expect(fence).toHaveBeenCalledOnce();
    const snapshot = await repository.readManualMatchCacheSnapshot();
    expect(snapshot.revision).toBe(fence.mock.calls[0][0]);
    expect(snapshot.rows.some(row => row.id === publishedRow.id)).toBe(false);
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

  it("rolls back a public mutation when its Runtime Cache fence cannot be written", async () => {
    const pendingInput = submission(`fence-rollback-pending-${randomUUID()}`);
    const pendingMatch = await repository.createManualMatch(
      published(pendingInput),
      "admin-a",
      async () => undefined,
    );
    manualMatchIds.push(pendingMatch.id);
    const [pendingBefore] = await cleanup`
      select revision from manual_match_cache_outbox
      where delivered_at is null order by revision desc limit 1
    `;

    const input = submission(`fence-rollback-${randomUUID()}`);
    const [before] = await cleanup`select count(*)::int as count from manual_match_cache_outbox`;
    await expect(repository.createManualMatch(
      published(input),
      "admin-a",
      async () => { throw new Error("cache unavailable"); },
    )).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    const [matches] = await cleanup`
      select count(*)::int as count from published_manual_matches where league = ${input.league}
    `;
    const [after] = await cleanup`select count(*)::int as count from manual_match_cache_outbox`;
    const [pendingAfter] = await cleanup`
      select revision from manual_match_cache_outbox
      where delivered_at is null order by revision desc limit 1
    `;
    expect(matches.count).toBe(0);
    expect(after.count).toBe(before.count);
    expect(Number(pendingAfter.revision)).toBe(Number(pendingBefore.revision));
  });

  it("uses the same monotonic revision for the mutation fence, outbox, and Runtime snapshot", async () => {
    const input = submission(`fence-revision-${randomUUID()}`);
    const fence = vi.fn<(revision: number) => Promise<void>>().mockResolvedValue(undefined);
    const match = await repository.createManualMatch(published(input), "admin-a", fence);
    manualMatchIds.push(match.id);
    expect(fence).toHaveBeenCalledOnce();
    const revision = fence.mock.calls[0][0];
    const [pending] = await cleanup`
      select revision, delivered_at from manual_match_cache_outbox where revision = ${revision}
    `;
    expect(Number(pending.revision)).toBe(revision);
    expect(pending.delivered_at).toBeNull();

    const cached: { value: CachedPublicMatches | null } = { value: null };
    const snapshot = await synchronizePublishedManualMatchesSnapshot(repository, async (value) => {
      cached.value = value;
    });
    expect(snapshot.revision).toBe(revision);
    expect(cached.value?.revision).toBe(revision);
    const [delivered] = await cleanup`
      select delivered_at from manual_match_cache_outbox where revision = ${revision}
    `;
    expect(delivered.delivered_at).toBeInstanceOf(Date);
  });

  it("reports the current revision and bounded pending outbox count together", async () => {
    const input = submission(`cache-status-${randomUUID()}`);
    const fence = vi.fn<(revision: number) => Promise<void>>().mockResolvedValue(undefined);
    const match = await repository.createManualMatch(published(input), "admin-a", fence);
    manualMatchIds.push(match.id);
    const revision = fence.mock.calls[0][0];

    const status = await repository.getManualMatchCacheStatus();

    expect(status.revision).toBe(revision);
    expect(status.pendingRevisions).toBe(1);
  });

  it("coalesces repeated undelivered snapshots so cache failures cannot grow pending rows", async () => {
    const fence = vi.fn<(revision: number) => Promise<void>>().mockResolvedValue(undefined);

    for (let index = 0; index < 24; index += 1) {
      const input = submission(`cache-outbox-failure-${index}-${randomUUID()}`);
      const match = await repository.createManualMatch(published(input), "admin-a", fence);
      manualMatchIds.push(match.id);
      const revision = fence.mock.calls.at(-1)?.[0];
      expect(revision).toBeDefined();

      await repository.markManualMatchCacheDeliveryFailed(revision!);
      const [pending] = await cleanup`
        select count(*)::int as count from manual_match_cache_outbox where delivered_at is null
      `;
      expect(pending.count).toBe(1);
    }

    const status = await repository.getManualMatchCacheStatus();
    expect(status.pendingRevisions).toBe(1);
  });

  it("makes manual match creation retries idempotent without allocating another revision", async () => {
    const input = submission(`idempotent-create-${randomUUID()}`);
    const operationKey = randomUUID();
    const fence = vi.fn<(revision: number) => Promise<void>>().mockResolvedValue(undefined);
    const first = await repository.createManualMatch(
      published(input),
      "admin-a",
      fence,
      operationKey,
    );
    manualMatchIds.push(first.id);
    const second = await repository.createManualMatch(
      { ...published(input), league: `${input.league} retry` },
      "admin-a",
      fence,
      operationKey,
    );
    expect(second.id).toBe(first.id);
    expect(second.league).toBe(first.league);
    expect(fence).toHaveBeenCalledOnce();
    const [matches] = await cleanup`
      select count(*)::int as count from published_manual_matches where operation_key = ${operationKey}
    `;
    expect(matches.count).toBe(1);
  });

  it("bounds waiting when another transaction holds the manual cache revision lock", async () => {
    await cleanup`select pg_advisory_lock(${MANUAL_MATCH_MUTATION_LOCK})`;
    const startedAt = Date.now();
    try {
      await expect(repository.createManualMatch(
        published(submission(`manual-lock-${randomUUID()}`)),
        "admin-a",
      )).rejects.toMatchObject({ code: "DATABASE_UNAVAILABLE" });
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await cleanup`select pg_advisory_unlock(${MANUAL_MATCH_MUTATION_LOCK})`;
    }
  });
});
