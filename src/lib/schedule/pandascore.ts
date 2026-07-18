import type {
  EndpointCoverage,
  EsportsMatch,
  GameCoverage,
  MatchStatus,
  PandaEndpointKey,
  PandaGameKey,
  Stream,
  Team,
} from "./types";
import { pandaEndpointKeys, pandaGameKeys } from "./types";

const PANDASCORE_API = "https://api.pandascore.co";
const PER_PAGE = 100;
const PAST_DAYS = 30;
const FUTURE_DAYS = 60;
const DAY_MS = 86_400_000;

const apiGamePaths: Record<PandaGameKey, string> = {
  lol: "lol",
  valorant: "valorant",
  cs2: "csgo",
  dota2: "dota2",
};

export type PandaOpponent = {
  opponent?: {
    id?: number | null;
    name?: string | null;
    acronym?: string | null;
    image_url?: string | null;
  } | null;
};

type PandaResult = {
  score?: number | null;
  team_id?: number | null;
};

type PandaStream = {
  language?: string | null;
  main?: boolean;
  official?: boolean;
  raw_url?: string | null;
  embed_url?: string | null;
};

export type PandaMatch = {
  id?: number;
  name?: string | null;
  scheduled_at?: string | null;
  begin_at?: string | null;
  end_at?: string | null;
  status?: string | null;
  number_of_games?: number | null;
  match_type?: string | null;
  opponents?: PandaOpponent[];
  results?: PandaResult[];
  streams_list?: PandaStream[];
  league?: { name?: string | null } | null;
  tournament?: { name?: string | null } | null;
  videogame?: { slug?: string | null; name?: string | null } | null;
  modified_at?: string | null;
};

type FilterReason = keyof EndpointCoverage["filtered"];

type NormalizedMatch = {
  match: EsportsMatch;
  endpoint: PandaEndpointKey;
};

type PaginatedEndpoint = {
  matches: PandaMatch[];
  pages: number;
  xTotal: number;
  rateLimitRemaining: number | null;
};

export type PandaScoreResult = {
  matches: EsportsMatch[];
  fetchedAt: string;
  rateLimitRemaining: number | null;
  games: Record<PandaGameKey, GameCoverage>;
  totals: {
    xTotal: number;
    raw: number;
    normalized: number;
    deduplicated: number;
    final: number;
  };
};

export type PandaFetchOptions = {
  now?: Date;
  fetchImpl?: typeof fetch;
};

function emptyStatusCounts(): Record<MatchStatus, number> {
  return {
    upcoming: 0,
    running: 0,
    finished: 0,
    postponed: 0,
    canceled: 0,
  };
}

function emptyFiltered(): EndpointCoverage["filtered"] {
  return {
    missingId: 0,
    missingTime: 0,
    invalidTime: 0,
    outsideWindow: 0,
    duplicate: 0,
  };
}

function mapStatus(status: string | null | undefined, endpoint: PandaEndpointKey): MatchStatus {
  switch (status) {
    case "running":
      return "running";
    case "finished":
      return "finished";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "postponed":
      return "postponed";
    case "not_started":
      return "upcoming";
    default:
      return endpoint === "running" ? "running" : endpoint === "past" ? "finished" : "upcoming";
  }
}

function mapTeam(opponent: PandaOpponent | undefined): Team {
  return {
    name: opponent?.opponent?.name?.trim() || "待定",
    acronym: opponent?.opponent?.acronym?.trim() || null,
    logo: opponent?.opponent?.image_url || null,
  };
}

function mapStreams(streams: PandaStream[] | undefined): Stream[] {
  return (streams ?? [])
    .map((stream) => ({
      label: stream.language?.toUpperCase() || (stream.main ? "主直播" : "直播"),
      url: stream.raw_url || stream.embed_url || "",
      official: stream.official,
    }))
    .filter((stream) => stream.url.startsWith("https://"));
}

function inferBestOf(match: PandaMatch): number | null {
  if (match.number_of_games && match.number_of_games > 0) return match.number_of_games;
  const parsed = Number(match.match_type?.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function scoreForOpponent(match: PandaMatch, index: number): number | null {
  const opponentId = match.opponents?.[index]?.opponent?.id;
  const result = opponentId
    ? match.results?.find((item) => item.team_id === opponentId)
    : match.results?.[index];
  return typeof result?.score === "number" ? result.score : null;
}

function validIsoOrFallback(value: string | null | undefined, fallback: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

export function normalizePandaMatch(
  raw: PandaMatch,
  game: PandaGameKey,
  endpoint: PandaEndpointKey,
  now = new Date(),
): { match: EsportsMatch | null; reason: FilterReason | null } {
  if (!Number.isFinite(raw.id)) return { match: null, reason: "missingId" };

  const effectiveTime = raw.begin_at?.trim() || raw.scheduled_at?.trim();
  if (!effectiveTime) return { match: null, reason: "missingTime" };
  const epoch = Date.parse(effectiveTime);
  if (Number.isNaN(epoch)) return { match: null, reason: "invalidTime" };

  const scheduledAt = new Date(epoch).toISOString();
  return {
    match: {
      id: `pandascore:${game}:${raw.id}`,
      game,
      scheduledAt,
      teams: [mapTeam(raw.opponents?.[0]), mapTeam(raw.opponents?.[1])],
      league: raw.league?.name?.trim() || "赛事待定",
      tournament: raw.tournament?.name?.trim() || null,
      bestOf: inferBestOf(raw),
      scores: [scoreForOpponent(raw, 0), scoreForOpponent(raw, 1)],
      status: mapStatus(raw.status, endpoint),
      streams: mapStreams(raw.streams_list),
      source: "pandascore",
      sourceUrl: null,
      updatedAt: validIsoOrFallback(raw.modified_at, now.toISOString()),
    },
    reason: null,
  };
}

export function getUtcCoverageWindow(now = new Date()) {
  const nowEpoch = now.getTime();
  return {
    pastStart: new Date(nowEpoch - PAST_DAYS * DAY_MS),
    now: new Date(nowEpoch),
    futureEnd: new Date(nowEpoch + FUTURE_DAYS * DAY_MS),
  };
}

function isInEndpointWindow(match: EsportsMatch, endpoint: PandaEndpointKey, now: Date): boolean {
  if (endpoint === "running") return true;
  const epoch = Date.parse(match.scheduledAt);
  const window = getUtcCoverageWindow(now);
  if (endpoint === "upcoming") {
    return epoch >= window.now.getTime() && epoch <= window.futureEnd.getTime();
  }
  return epoch >= window.pastStart.getTime() && epoch <= window.now.getTime();
}

function parseIntegerHeader(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw !== null && /^\d+$/.test(raw.trim())) return Number(raw);
  }
  return null;
}

export function nextPageFromLink(link: string | null): number | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel=["']?next["']?/i);
    if (!match) continue;
    try {
      const nextUrl = new URL(match[1]);
      const page = Number(nextUrl.searchParams.get("page"));
      if (Number.isInteger(page) && page > 0) return page;
    } catch {
      return null;
    }
  }
  return null;
}

function buildEndpointUrl(
  game: PandaGameKey,
  endpoint: PandaEndpointKey,
  page: number,
  now: Date,
): URL {
  const url = new URL(`/${apiGamePaths[game]}/matches/${endpoint}`, PANDASCORE_API);
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", endpoint === "past" ? "-begin_at" : "begin_at");

  if (endpoint !== "running") {
    const window = getUtcCoverageWindow(now);
    const start = endpoint === "past" ? window.pastStart : window.now;
    const end = endpoint === "past" ? window.now : window.futureEnd;
    url.searchParams.set("range[scheduled_at]", `${start.toISOString()},${end.toISOString()}`);
  }

  return url;
}

export async function fetchPaginatedEndpoint(
  game: PandaGameKey,
  endpoint: PandaEndpointKey,
  token: string,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<PaginatedEndpoint> {
  const matches: PandaMatch[] = [];
  let page = 1;
  let pages = 0;
  let xTotal: number | null = null;
  let rateLimitRemaining: number | null = null;
  const visited = new Set<number>();

  while (true) {
    if (visited.has(page) || pages >= 1_000) {
      throw new Error(`PandaScore pagination loop detected for ${game}/${endpoint}`);
    }
    visited.add(page);

    const response = await fetchImpl(buildEndpointUrl(game, endpoint, page, now), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      next: {
        revalidate: 900,
        tags: ["pandascore-fixtures-v3", `pandascore-${game}-${endpoint}`],
      },
    });

    if (!response.ok) {
      throw new Error(`PandaScore request failed for ${game}/${endpoint} with HTTP ${response.status}`);
    }

    const pageMatches = (await response.json()) as unknown;
    if (!Array.isArray(pageMatches)) {
      throw new Error(`PandaScore returned a non-list response for ${game}/${endpoint}`);
    }

    const pageTotal = parseIntegerHeader(response.headers, ["x-total"]);
    if (pageTotal === null) {
      throw new Error(`PandaScore omitted X-Total for ${game}/${endpoint}`);
    }
    if (xTotal !== null && pageTotal !== xTotal) {
      throw new Error(`PandaScore X-Total changed during pagination for ${game}/${endpoint}`);
    }
    xTotal = pageTotal;

    const remaining = parseIntegerHeader(response.headers, [
      "x-ratelimit-remaining",
      "x-rate-limit-remaining",
    ]);
    if (remaining !== null) {
      rateLimitRemaining = rateLimitRemaining === null
        ? remaining
        : Math.min(rateLimitRemaining, remaining);
    }

    matches.push(...(pageMatches as PandaMatch[]));
    pages += 1;

    const linkNext = nextPageFromLink(response.headers.get("link"));
    const reportedPage = parseIntegerHeader(response.headers, ["x-page"]) ?? page;
    const reportedPerPage = parseIntegerHeader(response.headers, ["x-per-page"]) ?? PER_PAGE;
    const headerNext = reportedPage * reportedPerPage < xTotal ? reportedPage + 1 : null;
    const nextPage = linkNext ?? headerNext;
    if (nextPage === null) break;
    page = nextPage;
  }

  if (matches.length !== xTotal) {
    throw new Error(
      `PandaScore pagination mismatch for ${game}/${endpoint}: fetched ${matches.length}, expected ${xTotal}`,
    );
  }

  return { matches, pages, xTotal, rateLimitRemaining };
}

function deduplicateNormalized(items: NormalizedMatch[]): NormalizedMatch[] {
  const unique = new Map<string, NormalizedMatch>();
  for (const item of items) {
    const existing = unique.get(item.match.id);
    if (!existing || Date.parse(item.match.updatedAt) >= Date.parse(existing.match.updatedAt)) {
      unique.set(item.match.id, item);
    }
  }
  return [...unique.values()];
}

function timeBounds(matches: EsportsMatch[]): { earliest: string | null; latest: string | null } {
  if (matches.length === 0) return { earliest: null, latest: null };
  const sorted = [...matches].sort(
    (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
  );
  return {
    earliest: sorted[0].scheduledAt,
    latest: sorted.at(-1)?.scheduledAt ?? null,
  };
}

async function fetchGame(
  game: PandaGameKey,
  token: string,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<{ matches: EsportsMatch[]; coverage: GameCoverage; rateLimitRemaining: number | null }> {
  const endpointResults = await Promise.all(
    pandaEndpointKeys.map(async (endpoint) => ({
      endpoint,
      result: await fetchPaginatedEndpoint(game, endpoint, token, fetchImpl, now),
    })),
  );

  const endpointCoverage = {} as Record<PandaEndpointKey, EndpointCoverage>;
  const allNormalized: NormalizedMatch[] = [];
  let minimumRemaining: number | null = null;

  for (const { endpoint, result } of endpointResults) {
    const filtered = emptyFiltered();
    const normalized: NormalizedMatch[] = [];
    for (const raw of result.matches) {
      const outcome = normalizePandaMatch(raw, game, endpoint, now);
      if (!outcome.match) {
        filtered[outcome.reason ?? "invalidTime"] += 1;
        continue;
      }
      normalized.push({ match: outcome.match, endpoint });
    }

    const endpointUnique = deduplicateNormalized(normalized);
    filtered.duplicate = normalized.length - endpointUnique.length;
    const final = endpointUnique.filter((item) => {
      const included = isInEndpointWindow(item.match, endpoint, now);
      if (!included) filtered.outsideWindow += 1;
      return included;
    });

    endpointCoverage[endpoint] = {
      pages: result.pages,
      xTotal: result.xTotal,
      raw: result.matches.length,
      normalized: normalized.length,
      deduplicated: endpointUnique.length,
      final: final.length,
      filtered,
    };
    allNormalized.push(...normalized);
    if (result.rateLimitRemaining !== null) {
      minimumRemaining = minimumRemaining === null
        ? result.rateLimitRemaining
        : Math.min(minimumRemaining, result.rateLimitRemaining);
    }
  }

  const combinedUnique = deduplicateNormalized(allNormalized);
  const finalItems = combinedUnique.filter((item) => isInEndpointWindow(item.match, item.endpoint, now));
  const matches = finalItems.map((item) => item.match);
  const statusCounts = emptyStatusCounts();
  for (const match of matches) statusCounts[match.status] += 1;
  const bounds = timeBounds(matches);

  const coverage: GameCoverage = {
    endpoints: endpointCoverage,
    pages: endpointResults.reduce((sum, item) => sum + item.result.pages, 0),
    xTotal: endpointResults.reduce((sum, item) => sum + item.result.xTotal, 0),
    raw: endpointResults.reduce((sum, item) => sum + item.result.matches.length, 0),
    normalized: allNormalized.length,
    deduplicated: combinedUnique.length,
    final: matches.length,
    statusCounts,
    earliestMatchAt: bounds.earliest,
    latestMatchAt: bounds.latest,
  };

  return { matches, coverage, rateLimitRemaining: minimumRemaining };
}

export async function getPandaScoreMatches(
  token: string,
  options: PandaFetchOptions = {},
): Promise<PandaScoreResult> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const gameResults = await Promise.all(
    pandaGameKeys.map(async (game) => ({
      game,
      result: await fetchGame(game, token, fetchImpl, now),
    })),
  );

  const games = {} as Record<PandaGameKey, GameCoverage>;
  const combined: EsportsMatch[] = [];
  let rateLimitRemaining: number | null = null;
  for (const { game, result } of gameResults) {
    games[game] = result.coverage;
    combined.push(...result.matches);
    if (result.rateLimitRemaining !== null) {
      rateLimitRemaining = rateLimitRemaining === null
        ? result.rateLimitRemaining
        : Math.min(rateLimitRemaining, result.rateLimitRemaining);
    }
  }

  const unique = new Map(combined.map((match) => [match.id, match]));
  const matches = [...unique.values()].sort(
    (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
  );

  return {
    matches,
    fetchedAt: now.toISOString(),
    rateLimitRemaining,
    games,
    totals: {
      xTotal: gameResults.reduce((sum, item) => sum + item.result.coverage.xTotal, 0),
      raw: gameResults.reduce((sum, item) => sum + item.result.coverage.raw, 0),
      normalized: gameResults.reduce((sum, item) => sum + item.result.coverage.normalized, 0),
      deduplicated: gameResults.reduce((sum, item) => sum + item.result.coverage.deduplicated, 0),
      final: matches.length,
    },
  };
}
