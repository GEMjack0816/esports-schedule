import "server-only";

import { getCache } from "@vercel/functions";
import { unstable_cache } from "next/cache";
import type { PublishedManualMatchRow } from "@/db/schema";
import type { EsportsMatch } from "@/lib/schedule/types";
import { uniqueAndSort } from "@/lib/schedule/utils";
import { isDatabaseConfigured } from "@/db";
import { getReviewRepository } from "./repository";
import type { ManualMatchCacheFence } from "./repository";
import type { SubmissionCounts } from "./types";

const CACHE_KEY = "published-manual-matches-v1";
const FENCE_KEY = "published-manual-matches-fence-v1";
const RUNTIME_FALLBACK_TAG = "published-manual-matches-fallback-v1";
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const DB_TIMEOUT_MS = 2_500;

export type CachedPublicMatches = {
  matches: EsportsMatch[];
  fetchedAt: string;
  revision: number;
  pendingCacheRevisions?: number;
};

export type DatabasePublicState = {
  configured: boolean;
  status: "connected" | "cached" | "unavailable" | "not-configured";
  lastSuccessfulReadAt: string | null;
  cachedManualMatches: number;
  cacheRevision: number;
  pendingCacheRevisions: number;
};

let publicState: DatabasePublicState = {
  configured: isDatabaseConfigured(),
  status: isDatabaseConfigured() ? "unavailable" : "not-configured",
  lastSuccessfulReadAt: null,
  cachedManualMatches: 0,
  cacheRevision: 0,
  pendingCacheRevisions: 0,
};

function publicCache() {
  return getCache({ namespace: "esports-schedule-review" });
}

function snapshotCacheKey(revision: number): string {
  return `${CACHE_KEY}:${revision}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = DB_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("database timeout")), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export function publishedRowToMatch(row: PublishedManualMatchRow): EsportsMatch {
  return {
    id: `manual:${row.game}:db-${row.id}`,
    provider: "manual",
    providerMatchId: `db-${row.id}`,
    game: row.game as EsportsMatch["game"],
    tournament: row.tournament,
    league: row.league,
    stage: row.stage,
    homeTeam: {
      name: row.homeTeamName || "待定",
      acronym: row.homeTeamAcronym,
      logo: row.homeTeamLogo || "/team-placeholder.svg",
    },
    awayTeam: {
      name: row.awayTeamName || "待定",
      acronym: row.awayTeamAcronym,
      logo: row.awayTeamLogo || "/team-placeholder.svg",
    },
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    bestOf: row.bestOf,
    status: row.status as EsportsMatch["status"],
    startTimeUtc: row.startTimeUtc?.toISOString() ?? null,
    streams: row.streamUrl ? [{ label: "直播", url: row.streamUrl, official: false }] : [],
    lastUpdatedAt: row.updatedAt.toISOString(),
    sourceUrl: row.sourceUrl,
    manualOverride: true,
  };
}

function isCachedPublicMatches(value: unknown): value is CachedPublicMatches {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CachedPublicMatches>;
  return typeof candidate.fetchedAt === "string"
    && Array.isArray(candidate.matches)
    && Number.isSafeInteger(candidate.revision)
    && (candidate.revision ?? -1) >= 0
    && (candidate.pendingCacheRevisions === undefined
      || (Number.isSafeInteger(candidate.pendingCacheRevisions)
        && (candidate.pendingCacheRevisions ?? -1) >= 0));
}

function isCacheFence(value: unknown): value is { revision: number } {
  if (!value || typeof value !== "object") return false;
  const revision = (value as { revision?: unknown }).revision;
  return Number.isSafeInteger(revision) && Number(revision) >= 0;
}

function observeManualMatchRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("invalid manual match cache revision");
  }
  if (revision < publicState.cacheRevision) {
    throw new Error("manual match cache revision regressed");
  }
  if (revision > publicState.cacheRevision) {
    publicState = { ...publicState, cacheRevision: revision };
  }
}

export function selectRuntimeFallback(snapshot: unknown, fence: unknown, minimumRevision = 0): CachedPublicMatches | null {
  if (!isCachedPublicMatches(snapshot)) return null;
  // The snapshot and fence can be evicted independently. Without the fence,
  // a surviving snapshot may predate a hide/edit whose cache delivery failed.
  if (!isCacheFence(fence)) return null;
  return snapshot.revision < Math.max(fence.revision, minimumRevision) ? null : snapshot;
}

export async function writeManualMatchCacheFence(revision: number): Promise<void> {
  // This write runs while the repository holds the serialized mutation lock.
  // Do not wrap it in Promise.race: Runtime Cache writes cannot be cancelled,
  // so abandoning an older write would let it complete after a newer revision
  // and regress the fence. A rejected write rolls the database transaction back.
  await publicCache().set(FENCE_KEY, { revision }, {
    name: "Published manual matches minimum cache revision",
    tags: [RUNTIME_FALLBACK_TAG],
    ttl: CACHE_TTL_SECONDS,
  });
}

async function readLastSuccess(minimumRevision: number): Promise<CachedPublicMatches | null> {
  try {
    const cache = publicCache();
    const fence = await cache.get(FENCE_KEY);
    if (!isCacheFence(fence)) return null;

    // Keep the process-local high-water mark in the comparison too. A prior
    // successful database read can know about a newer generation than this
    // region's Runtime Cache fence (Runtime Cache is region-local).
    const requiredRevision = Math.max(minimumRevision, publicState.cacheRevision, fence.revision);
    const versioned = await cache.get(snapshotCacheKey(requiredRevision));
    if (isCachedPublicMatches(versioned) && versioned.revision >= requiredRevision) {
      return selectRuntimeFallback(versioned, fence, requiredRevision);
    }

    // Read pre-versioned snapshots during rollout only when their stored
    // revision still satisfies the current fence/high-water mark.
    const legacy = await cache.get(CACHE_KEY);
    return selectRuntimeFallback(legacy, fence, requiredRevision);
  } catch {
    return null;
  }
}

async function writeRuntimeFallback(value: CachedPublicMatches): Promise<void> {
  // A fixed key lets a slow older read overwrite a newer snapshot after its
  // set() completes. Per-generation keys make writes immutable with respect
  // to each other; the fence selects which generation may be served.
  await publicCache().set(snapshotCacheKey(value.revision), value, {
    name: "Published manual matches last successful database read",
    tags: [RUNTIME_FALLBACK_TAG],
    ttl: CACHE_TTL_SECONDS,
  });
}

export async function synchronizePublishedManualMatchesSnapshot(
  repository: Pick<ReturnType<typeof getReviewRepository>,
    "readManualMatchCacheSnapshot" | "markManualMatchCacheDelivered" | "markManualMatchCacheDeliveryFailed"
  > = getReviewRepository(),
  write: (value: CachedPublicMatches) => Promise<void> = writeRuntimeFallback,
  writeFence: ManualMatchCacheFence = async () => undefined,
): Promise<CachedPublicMatches & { cacheSynchronized: boolean }> {
  // Fence restoration must happen while the repository still holds its
  // serialized mutation lock; writing it after this read returns can regress a
  // newer mutation's fence.
  const snapshot = await repository.readManualMatchCacheSnapshot(writeFence);
  const value = {
    matches: uniqueAndSort(snapshot.rows.map(publishedRowToMatch)),
    fetchedAt: new Date().toISOString(),
    revision: snapshot.revision,
    pendingCacheRevisions: snapshot.pendingRevisions,
  };
  let delivered = snapshot.fenceWritten !== false;
  try {
    await write(value);
  } catch {
    delivered = false;
    console.warn("[review-db] public manual match fallback snapshot could not be written");
  }
  if (!delivered) {
    await repository.markManualMatchCacheDeliveryFailed(snapshot.revision);
    return { ...value, cacheSynchronized: false };
  }
  try {
    await repository.markManualMatchCacheDelivered(snapshot.revision);
  } catch {
    console.warn("[review-db] manual match cache delivery acknowledgement failed");
  }
  return { ...value, cacheSynchronized: true };
}

async function readCurrentFence(): Promise<{ available: boolean; revision: number }> {
  try {
    const value = await publicCache().get(FENCE_KEY);
    // A missing Runtime Cache fence may mean that this regional/ephemeral cache
    // was evicted. It is not proof that revision zero is current, so force a
    // PostgreSQL snapshot comparison instead of trusting a possibly older
    // Next Data Cache entry.
    if (value === null) return { available: false, revision: 0 };
    return isCacheFence(value)
      ? { available: true, revision: value.revision }
      : { available: false, revision: 0 };
  } catch {
    return { available: false, revision: 0 };
  }
}

export function shouldRefreshCachedSnapshot(
  cachedRevision: number,
  fence: { available: boolean; revision: number },
): boolean {
  return !fence.available || cachedRevision < fence.revision;
}

export async function preserveLastSuccessfulPublicMatches(
  load: () => Promise<CachedPublicMatches>,
  readFallback: () => Promise<CachedPublicMatches | null>,
): Promise<{ value: CachedPublicMatches | null; fallback: boolean }> {
  try {
    return { value: await load(), fallback: false };
  } catch {
    return { value: await readFallback(), fallback: true };
  }
}

const readPublishedMatchesCached = unstable_cache(
  async (): Promise<CachedPublicMatches> => {
    return synchronizePublishedManualMatchesSnapshot(
      getReviewRepository(),
      writeRuntimeFallback,
      writeManualMatchCacheFence,
    );
  },
  ["published-manual-matches-v1"],
  {
    tags: ["published-manual-matches"],
    revalidate: 60,
  },
);

async function readCurrentPublishedMatches(observeRevision: (revision: number) => void): Promise<
  CachedPublicMatches & { pendingCacheRevisions: number }
> {
  // Runtime Cache is regional and set() has no CAS or cancellation support.
  // Fence writes are awaited under the serialized mutation transaction; this
  // read still uses PostgreSQL's committed revision as the authoritative check.
  // A matching Next Data Cache entry is not proof that the Runtime Cache
  // delivery succeeded: the outbox may still contain a pending revision.
  const repository = getReviewRepository();
  const cacheStatus = await repository.getManualMatchCacheStatus();
  const revision = cacheStatus.revision;
  observeRevision(revision);
  const cached = await readPublishedMatchesCached();
  const fence = await readCurrentFence();
  if (cacheStatus.pendingRevisions > 0
    || cached.revision !== revision
    || shouldRefreshCachedSnapshot(cached.revision, fence)) {
    const refreshed = await synchronizePublishedManualMatchesSnapshot(
      repository,
      writeRuntimeFallback,
      writeManualMatchCacheFence,
    );
    observeRevision(refreshed.revision);
    if (refreshed.revision < publicState.cacheRevision) {
      throw new Error("manual match cache revision regressed");
    }
    // A concurrent mutation can enqueue a newer outbox row while this
    // snapshot is being delivered. Read the pending count after delivery so
    // health does not report a clean cache just because this older snapshot
    // was written successfully.
    let pendingCacheRevisions = cacheStatus.pendingRevisions;
    try {
      const currentStatus = await repository.getManualMatchCacheStatus();
      pendingCacheRevisions = currentStatus.pendingRevisions;
    } catch {
      // The database snapshot already succeeded. Keep serving it if this
      // follow-up status read fails, retaining the last known pending count.
      console.warn("[review-db] manual cache pending status refresh failed");
    }
    return { ...refreshed, pendingCacheRevisions };
  }
  if (cached.revision < publicState.cacheRevision) {
    throw new Error("manual match cache revision regressed");
  }
  return { ...cached, pendingCacheRevisions: cacheStatus.pendingRevisions };
}

export async function getPublishedDatabaseMatches(): Promise<{
  matches: EsportsMatch[];
  state: DatabasePublicState;
}> {
  const configured = isDatabaseConfigured();
  if (!configured) {
    publicState = {
      configured: false,
      status: "not-configured",
      lastSuccessfulReadAt: null,
      cachedManualMatches: 0,
      cacheRevision: 0,
      pendingCacheRevisions: 0,
    };
    return { matches: [], state: publicState };
  }

  // A snapshot at the Runtime Cache fence with no pending outbox delivery is
  // already a verified last-known-good view. Serve it without making every
  // public schedule request wait on PostgreSQL; mutations advance the fence
  // before commit, so a newer committed view cannot be hidden by this key.
  const runtimeSnapshot = await readLastSuccess(publicState.cacheRevision);
  if (runtimeSnapshot?.pendingCacheRevisions === 0) {
    observeManualMatchRevision(runtimeSnapshot.revision);
    publicState = {
      configured: true,
      status: "cached",
      lastSuccessfulReadAt: runtimeSnapshot.fetchedAt,
      cachedManualMatches: runtimeSnapshot.matches.length,
      cacheRevision: runtimeSnapshot.revision,
      pendingCacheRevisions: 0,
    };
    return { matches: runtimeSnapshot.matches, state: publicState };
  }

  // A warm function instance may already have served a newer generation than
  // the local Runtime Cache region currently holds. Never accept fallback data
  // below that observed high-water mark when a later database read fails.
  let observedRevision = publicState.cacheRevision;
  const result = await preserveLastSuccessfulPublicMatches(
    () => withTimeout(readCurrentPublishedMatches((revision) => {
      if (revision < publicState.cacheRevision) {
        throw new Error("manual match cache revision regressed");
      }
      observedRevision = Math.max(observedRevision, revision);
      observeManualMatchRevision(revision);
    })),
    // If the full read fails after the committed watermark was observed,
    // never let a regressed regional fence authorize an older snapshot.
    () => readLastSuccess(observedRevision),
  );
  if (result.value && !result.fallback && result.value.revision >= publicState.cacheRevision) {
    const value = result.value;
    observeManualMatchRevision(value.revision);
    publicState = {
      configured: true,
      status: "connected",
      lastSuccessfulReadAt: value.fetchedAt,
      cachedManualMatches: value.matches.length,
      cacheRevision: Math.max(publicState.cacheRevision, value.revision),
      pendingCacheRevisions: value.pendingCacheRevisions ?? 0,
    };
    return { matches: value.matches, state: publicState };
  }

  // Another overlapping request can advance the process watermark after this
  // request starts reading the regional fallback. Filter again before return.
  const cached = result.value && result.value.revision >= publicState.cacheRevision
    ? result.value
    : null;
  publicState = {
    configured: true,
    status: cached ? "cached" : "unavailable",
    lastSuccessfulReadAt: cached?.fetchedAt ?? publicState.lastSuccessfulReadAt,
    cachedManualMatches: cached?.matches.length ?? 0,
    cacheRevision: Math.max(cached?.revision ?? 0, publicState.cacheRevision),
    pendingCacheRevisions: publicState.pendingCacheRevisions,
  };
  console.warn("[review-db] database read unavailable; preserving last successful public manual matches");
  return { matches: cached?.matches ?? [], state: publicState };
}

export function getDatabasePublicState(): DatabasePublicState {
  return { ...publicState };
}

export async function getDatabaseHealth(): Promise<DatabasePublicState & {
  submissionCounts: SubmissionCounts | null;
}> {
  if (!isDatabaseConfigured()) {
    return { ...getDatabasePublicState(), submissionCounts: null };
  }
  try {
    const [counts, , cacheStatus] = await withTimeout(Promise.all([
      getReviewRepository().getSubmissionCounts(),
      getReviewRepository().ping(),
      getReviewRepository().getManualMatchCacheStatus(),
    ]));
    observeManualMatchRevision(cacheStatus.revision);
    publicState = {
      ...getDatabasePublicState(),
      configured: true,
      status: "connected",
      cacheRevision: cacheStatus.revision,
      pendingCacheRevisions: cacheStatus.pendingRevisions,
    };
    return { ...publicState, submissionCounts: counts };
  } catch {
    const lastSuccessfulReadAt = getDatabasePublicState().lastSuccessfulReadAt;
    return {
      ...getDatabasePublicState(),
      configured: true,
      // An empty snapshot is still a successful snapshot. Use its timestamp to
      // distinguish "cached and empty" from "no usable cache has ever existed".
      status: lastSuccessfulReadAt ? "cached" : "unavailable",
      submissionCounts: null,
    };
  }
}
