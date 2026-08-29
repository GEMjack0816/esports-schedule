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
const RUNTIME_FALLBACK_TAG = "published-manual-matches-fallback-v1";
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const DB_TIMEOUT_MS = 2_500;

export type CachedPublicMatches = {
  matches: EsportsMatch[];
  fetchedAt: string;
};

export type DatabasePublicState = {
  configured: boolean;
  status: "connected" | "cached" | "unavailable" | "not-configured";
  lastSuccessfulReadAt: string | null;
  cachedManualMatches: number;
};

let publicState: DatabasePublicState = {
  configured: isDatabaseConfigured(),
  status: isDatabaseConfigured() ? "unavailable" : "not-configured",
  lastSuccessfulReadAt: null,
  cachedManualMatches: 0,
};

function publicCache() {
  return getCache({ namespace: "esports-schedule-review" });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = DB_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timeout = setTimeout(() => reject(new Error("database timeout")), timeoutMs);
      timeout.unref?.();
    }),
  ]);
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
  return typeof candidate.fetchedAt === "string" && Array.isArray(candidate.matches);
}

async function readLastSuccess(): Promise<CachedPublicMatches | null> {
  try {
    const value = await publicCache().get(CACHE_KEY);
    return isCachedPublicMatches(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeLastSuccess(value: CachedPublicMatches): Promise<void> {
  try {
    await writeRuntimeFallback(value);
  } catch {
    console.warn("[review-db] public manual match fallback cache could not be written");
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
  repository: Pick<ReturnType<typeof getReviewRepository>, "listVisibleManualMatches"> = getReviewRepository(),
  write: (value: CachedPublicMatches) => Promise<void> = writeRuntimeFallback,
): Promise<CachedPublicMatches> {
  const rows = await repository.listVisibleManualMatches();
  const value = {
    matches: uniqueAndSort(rows.map(publishedRowToMatch)),
    fetchedAt: new Date().toISOString(),
  };
  await write(value);
  return value;
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
    const rows = await getReviewRepository().listVisibleManualMatches();
    const value = {
      matches: uniqueAndSort(rows.map(publishedRowToMatch)),
      fetchedAt: new Date().toISOString(),
    };
    await writeLastSuccess(value);
    return value;
  },
  ["published-manual-matches-v1"],
  {
    tags: ["published-manual-matches"],
    revalidate: 60,
  },
);

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
    };
    return { matches: [], state: publicState };
  }

  const result = await preserveLastSuccessfulPublicMatches(
    () => withTimeout(readPublishedMatchesCached()),
    readLastSuccess,
  );
  if (result.value && !result.fallback) {
    const value = result.value;
    publicState = {
      configured: true,
      status: "connected",
      lastSuccessfulReadAt: value.fetchedAt,
      cachedManualMatches: value.matches.length,
    };
    return { matches: value.matches, state: publicState };
  }

  const cached = result.value;
  publicState = {
    configured: true,
    status: cached ? "cached" : "unavailable",
    lastSuccessfulReadAt: cached?.fetchedAt ?? publicState.lastSuccessfulReadAt,
    cachedManualMatches: cached?.matches.length ?? 0,
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
    const [counts] = await withTimeout(Promise.all([
      getReviewRepository().getSubmissionCounts(),
      getReviewRepository().ping(),
    ]));
    return {
      ...getDatabasePublicState(),
      configured: true,
      status: "connected",
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
