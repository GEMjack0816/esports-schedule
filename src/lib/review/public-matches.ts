import "server-only";

import { getCache } from "@vercel/functions";
import { unstable_cache } from "next/cache";
import type { PublishedManualMatchRow } from "@/db/schema";
import type { EsportsMatch } from "@/lib/schedule/types";
import { uniqueAndSort } from "@/lib/schedule/utils";
import { isDatabaseConfigured } from "@/db";
import { getReviewRepository } from "./repository";
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
    && (candidate.revision ?? -1) >= 0;
}

function isCacheFence(value: unknown): value is { revision: number } {
  if (!value || typeof value !== "object") return false;
  const revision = (value as { revision?: unknown }).revision;
  return Number.isSafeInteger(revision) && Number(revision) >= 0;
}

export function selectRuntimeFallback(snapshot: unknown, fence: unknown, minimumRevision = 0): CachedPublicMatches | null {
  if (!isCachedPublicMatches(snapshot)) return null;
  // The snapshot and fence can be evicted independently. Without the fence,
  // a surviving snapshot may predate a hide/edit whose cache delivery failed.
  if (!isCacheFence(fence)) return null;
  return snapshot.revision < Math.max(fence.revision, minimumRevision) ? null : snapshot;
}

export async function writeManualMatchCacheFence(revision: number): Promise<void> {
  await withTimeout(publicCache().set(FENCE_KEY, { revision }, {
    name: "Published manual matches minimum cache revision",
    tags: [RUNTIME_FALLBACK_TAG],
    ttl: CACHE_TTL_SECONDS,
  }));
}

async function readLastSuccess(minimumRevision: number): Promise<CachedPublicMatches | null> {
  try {
    const cache = publicCache();
    const [value, fence] = await Promise.all([cache.get(CACHE_KEY), cache.get(FENCE_KEY)]);
    return selectRuntimeFallback(value, fence, minimumRevision);
  } catch {
    return null;
  }
}

async function writeRuntimeFallback(value: CachedPublicMatches): Promise<void> {
  await publicCache().set(CACHE_KEY, value, {
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
): Promise<CachedPublicMatches> {
  const snapshot = await repository.readManualMatchCacheSnapshot();
  const value = {
    matches: uniqueAndSort(snapshot.rows.map(publishedRowToMatch)),
    fetchedAt: new Date().toISOString(),
    revision: snapshot.revision,
  };
  try {
    await write(value);
  } catch {
    await repository.markManualMatchCacheDeliveryFailed(snapshot.revision);
    console.warn("[review-db] public manual match fallback cache could not be written");
    return value;
  }
  try {
    await repository.markManualMatchCacheDelivered(snapshot.revision);
  } catch {
    console.warn("[review-db] manual match cache delivery acknowledgement failed");
  }
  return value;
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
    return synchronizePublishedManualMatchesSnapshot(getReviewRepository());
  },
  ["published-manual-matches-v1"],
  {
    tags: ["published-manual-matches"],
    revalidate: 60,
  },
);

async function readCurrentPublishedMatches(observeRevision: (revision: number) => void): Promise<CachedPublicMatches> {
  // Runtime Cache is regional and set() has no CAS or cancellation support.
  // A timed-out set may finish late and regress its fence. Only PostgreSQL's
  // committed revision can prove that an otherwise matching cache is current.
  const repository = getReviewRepository();
  const revision = await repository.getCurrentManualMatchRevision();
  observeRevision(revision);
  const cached = await readPublishedMatchesCached();
  const fence = await readCurrentFence();
  if (cached.revision !== revision || shouldRefreshCachedSnapshot(cached.revision, fence)) {
    return synchronizePublishedManualMatchesSnapshot(repository);
  }
  return cached;
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

  let observedRevision = 0;
  const result = await preserveLastSuccessfulPublicMatches(
    () => withTimeout(readCurrentPublishedMatches((revision) => {
      observedRevision = Math.max(observedRevision, revision);
    })),
    // If the full read fails after the committed watermark was observed,
    // never let a regressed regional fence authorize an older snapshot.
    () => readLastSuccess(observedRevision),
  );
  if (result.value && !result.fallback) {
    const value = result.value;
    publicState = {
      configured: true,
      status: "connected",
      lastSuccessfulReadAt: value.fetchedAt,
      cachedManualMatches: value.matches.length,
      cacheRevision: value.revision,
      pendingCacheRevisions: 0,
    };
    return { matches: value.matches, state: publicState };
  }

  const cached = result.value;
  publicState = {
    configured: true,
    status: cached ? "cached" : "unavailable",
    lastSuccessfulReadAt: cached?.fetchedAt ?? publicState.lastSuccessfulReadAt,
    cachedManualMatches: cached?.matches.length ?? 0,
    cacheRevision: cached?.revision ?? publicState.cacheRevision,
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
    return {
      ...getDatabasePublicState(),
      configured: true,
      status: "connected",
      cacheRevision: cacheStatus.revision,
      pendingCacheRevisions: cacheStatus.pendingRevisions,
      submissionCounts: counts,
    };
  } catch {
    return {
      ...getDatabasePublicState(),
      configured: true,
      status: getDatabasePublicState().cachedManualMatches > 0 ? "cached" : "unavailable",
      submissionCounts: null,
    };
  }
}
