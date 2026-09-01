import type {
  EndpointCoverage,
  EsportsMatch,
  GameCoverage,
  MatchStatus,
  PandaEndpointKey,
  PandaGameKey,
  ProviderVerificationSample,
  Stream,
  Team,
} from "./types";
import { pandaEndpointKeys, pandaGameKeys } from "./types";
import { normalizeMatchStatus } from "./status";

const PANDASCORE_API = "https://api.pandascore.co";
const PER_PAGE = 100;
const PAST_DAYS = 30;
const FUTURE_DAYS = 60;
const DAY_MS = 86_400_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 2;

export const apiGamePaths: Record<PandaGameKey, string> = {
  lol: "lol",
  valorant: "valorant",
  "honor-of-kings": "kog",
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
  serie?: { name?: string | null; full_name?: string | null } | null;
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

export type PandaGameSnapshot = {
  game: PandaGameKey;
  matches: EsportsMatch[];
  fetchedAt: string;
  /** Monotonic PostgreSQL-issued sync generation used only for persistence fencing. */
  syncGeneration?: number;
  rateLimitRemaining: number | null;
  coverage: GameCoverage;
};

export type PandaSyncFailure = {
  game: PandaGameKey;
  code: string;
  status: number | null;
  message: string;
};

export type PandaScoreSyncBatch = {
  snapshots: Partial<Record<PandaGameKey, PandaGameSnapshot>>;
  updatedGames: PandaGameKey[];
  failures: Partial<Record<PandaGameKey, PandaSyncFailure>>;
};

export type PandaScoreResult = {
  matches: EsportsMatch[];
  fetchedAt: string;
  rateLimitRemaining: number | null;
  games: Record<PandaGameKey, GameCoverage>;
  snapshots: Partial<Record<PandaGameKey, PandaGameSnapshot>>;
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
  clock?: () => Date;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
};

export class PandaScoreRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PandaScoreRequestError";
  }
}

function emptyStatusCounts(): Record<MatchStatus, number> {
  return {
    scheduled: 0,
    running: 0,
    finished: 0,
    postponed: 0,
    cancelled: 0,
    forfeit: 0,
    unknown: 0,
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

function mapTeam(opponent: PandaOpponent | undefined): Team {
  return {
    name: opponent?.opponent?.name?.trim() || "待定",
    acronym: opponent?.opponent?.acronym?.trim() || null,
    logo: opponent?.opponent?.image_url || "/team-placeholder.svg",
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

  const effectiveTime = raw.begin_at?.trim() || raw.scheduled_at?.trim() || null;
  if (effectiveTime && Number.isNaN(Date.parse(effectiveTime))) {
    return { match: null, reason: "invalidTime" };
  }

  const providerMatchId = String(raw.id);
  const startTimeUtc = effectiveTime ? new Date(effectiveTime).toISOString() : null;
  const normalizedStatus = normalizeMatchStatus(raw.status, {
    endpoint,
    startTimeUtc,
    now,
    onUnknown(value) {
      const safeValue = value.replace(/[^a-z0-9_:.]/g, "").slice(0, 64) || "invalid";
      console.warn(`[schedule-status] unknown upstream status game=${game} match=${providerMatchId} status=${safeValue}`);
    },
  });
  return {
    match: {
      id: `pandascore:${game}:${providerMatchId}`,
      provider: "pandascore",
      providerMatchId,
      game,
      tournament: raw.serie?.full_name?.trim() || raw.serie?.name?.trim() || null,
      league: raw.league?.name?.trim() || "赛事待定",
      stage: raw.tournament?.name?.trim() || null,
      homeTeam: mapTeam(raw.opponents?.[0]),
      awayTeam: mapTeam(raw.opponents?.[1]),
      homeScore: scoreForOpponent(raw, 0),
      awayScore: scoreForOpponent(raw, 1),
      bestOf: inferBestOf(raw),
      status: normalizedStatus.status,
      startTimeUtc,
      streams: mapStreams(raw.streams_list),
      lastUpdatedAt: validIsoOrFallback(raw.modified_at, now.toISOString()),
      sourceUrl: null,
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
  if (endpoint === "running" || !match.startTimeUtc) return true;
  const epoch = Date.parse(match.startTimeUtc);
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
      const page = Number(nextUrl.searchParams.get("page") ?? nextUrl.searchParams.get("page[number]"));
      if (Number.isInteger(page) && page > 0) return page;
    } catch {
      return null;
    }
  }
  return null;
}

export function buildPandaEndpointUrl(
  game: PandaGameKey,
  endpoint: PandaEndpointKey,
  page: number,
  now: Date,
): URL {
  const url = new URL(`/${apiGamePaths[game]}/matches/${endpoint}`, PANDASCORE_API);
  url.searchParams.set("per_page", String(PER_PAGE));
  url.searchParams.set("page", String(page));
  if (endpoint === "past") url.searchParams.set("sort", "-begin_at");
  if (endpoint === "upcoming") url.searchParams.set("sort", "begin_at");
  if (endpoint === "running") url.searchParams.set("sort", "begin_at");

  if (endpoint !== "running") {
    const window = getUtcCoverageWindow(now);
    const start = endpoint === "past" ? window.pastStart : window.now;
    const end = endpoint === "past" ? window.now : window.futureEnd;
    url.searchParams.set("range[scheduled_at]", `${start.toISOString()},${end.toISOString()}`);
  }

  return url;
}

function retryAfterMilliseconds(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+(\.\d+)?$/.test(retryAfter.trim())) {
    return Math.min(Number(retryAfter) * 1_000, 15_000);
  }
  return Math.min(500 * 2 ** attempt, 4_000);
}

function responseError(
  response: Response,
  game: PandaGameKey,
  endpoint: PandaEndpointKey,
): PandaScoreRequestError {
  const status = response.status;
  const prefix = `PandaScore ${game}/${endpoint}`;
  if (status === 401) return new PandaScoreRequestError(`${prefix} authentication failed (HTTP 401)`, "AUTH", status, false);
  if (status === 429) return new PandaScoreRequestError(`${prefix} rate limited (HTTP 429)`, "RATE_LIMIT", status, true);
  if (status >= 500) return new PandaScoreRequestError(`${prefix} server error (HTTP ${status})`, "UPSTREAM", status, true);
  if (status === 408) return new PandaScoreRequestError(`${prefix} timed out (HTTP 408)`, "TIMEOUT", status, true);
  return new PandaScoreRequestError(`${prefix} request failed (HTTP ${status})`, "HTTP_ERROR", status, false);
}

async function requestPage(
  url: URL,
  game: PandaGameKey,
  endpoint: PandaEndpointKey,
  token: string,
  options: Required<Pick<PandaFetchOptions, "fetchImpl" | "sleep" | "timeoutMs" | "maxRetries">>,
): Promise<Response> {
  let lastError: PandaScoreRequestError | null = null;
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await options.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
        // Runtime Cache is the authoritative last-success snapshot. A second
        // Next Data Cache layer can return stale upstream pages while stamping
        // the new snapshot with the current time, so sync requests bypass it.
        cache: "no-store",
      });
      if (response.ok) return response;
      const error = responseError(response, game, endpoint);
      if (!error.retryable || attempt === options.maxRetries) throw error;
      lastError = error;
      await options.sleep(retryAfterMilliseconds(response, attempt));
    } catch (error) {
      const normalized = error instanceof PandaScoreRequestError
        ? error
        : error instanceof DOMException && error.name === "AbortError"
          ? new PandaScoreRequestError(`PandaScore ${game}/${endpoint} request timed out`, "TIMEOUT", null, true)
          : new PandaScoreRequestError(`PandaScore ${game}/${endpoint} network request failed`, "NETWORK", null, true);
      if (!normalized.retryable || attempt === options.maxRetries) throw normalized;
      lastError = normalized;
      await options.sleep(Math.min(500 * 2 ** attempt, 4_000));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new PandaScoreRequestError("PandaScore request failed", "UNKNOWN", null, false);
}

export async function fetchPaginatedEndpoint(
  game: PandaGameKey,
  endpoint: PandaEndpointKey,
  token: string,
  fetchImpl: typeof fetch,
  now: Date,
  retryOptions: Omit<PandaFetchOptions, "now" | "fetchImpl"> = {},
): Promise<PaginatedEndpoint> {
  const matches: PandaMatch[] = [];
  let page = 1;
  let pages = 0;
  let xTotal: number | null = null;
  let rateLimitRemaining: number | null = null;
  const visited = new Set<number>();
  const requestOptions = {
    fetchImpl,
    sleep: retryOptions.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    timeoutMs: retryOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: retryOptions.maxRetries ?? DEFAULT_MAX_RETRIES,
  };

  while (true) {
    if (visited.has(page) || pages >= 1_000) {
      throw new PandaScoreRequestError(`PandaScore pagination loop for ${game}/${endpoint}`, "PAGINATION_LOOP", null, false);
    }
    visited.add(page);

    const response = await requestPage(
      buildPandaEndpointUrl(game, endpoint, page, now),
      game,
      endpoint,
      token,
      requestOptions,
    );
    const pageMatches = (await response.json()) as unknown;
    if (!Array.isArray(pageMatches)) {
      throw new PandaScoreRequestError(`PandaScore returned non-list data for ${game}/${endpoint}`, "INVALID_RESPONSE", response.status, false);
    }

    const pageTotal = parseIntegerHeader(response.headers, ["x-total"]);
    if (pageTotal === null) {
      throw new PandaScoreRequestError(`PandaScore omitted X-Total for ${game}/${endpoint}`, "MISSING_TOTAL", response.status, false);
    }
    if (xTotal !== null && pageTotal !== xTotal) {
      throw new PandaScoreRequestError(`PandaScore X-Total changed for ${game}/${endpoint}`, "TOTAL_CHANGED", response.status, false);
    }
    xTotal = pageTotal;

    const remaining = parseIntegerHeader(response.headers, ["x-ratelimit-remaining", "x-rate-limit-remaining"]);
    if (remaining !== null) {
      rateLimitRemaining = rateLimitRemaining === null ? remaining : Math.min(rateLimitRemaining, remaining);
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
    throw new PandaScoreRequestError(
      `PandaScore pagination mismatch for ${game}/${endpoint}: fetched ${matches.length}, expected ${xTotal}`,
      "PAGINATION_MISMATCH",
      null,
      false,
    );
  }

  return { matches, pages, xTotal, rateLimitRemaining };
}

function dedupeKey(match: EsportsMatch): string {
  return `${match.provider}:${match.providerMatchId}`;
}

function deduplicateNormalized(items: NormalizedMatch[]): NormalizedMatch[] {
  const unique = new Map<string, NormalizedMatch>();
  for (const item of items) {
    const key = dedupeKey(item.match);
    const existing = unique.get(key);
    const runningEndpointWins = item.endpoint === "running" && existing?.endpoint !== "running";
    const existingRunningEndpointWins = existing?.endpoint === "running" && item.endpoint !== "running";
    const itemUpdatedAt = Date.parse(item.match.lastUpdatedAt);
    const existingUpdatedAt = existing ? Date.parse(existing.match.lastUpdatedAt) : Number.NaN;
    if (
      !existing
      || runningEndpointWins
      || (!existingRunningEndpointWins && itemUpdatedAt >= existingUpdatedAt)
    ) {
      unique.set(key, item);
    }
  }
  return [...unique.values()];
}

function timeBounds(matches: EsportsMatch[]): { earliest: string | null; latest: string | null } {
  const times = matches
    .map((match) => match.startTimeUtc)
    .filter((value): value is string => value !== null)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return { earliest: times[0] ?? null, latest: times.at(-1) ?? null };
}

function verificationSample(
  completed: Array<{ endpoint: PandaEndpointKey; result: PaginatedEndpoint }>,
  matches: EsportsMatch[],
): ProviderVerificationSample | null {
  const normalized = matches.find((match) => match.startTimeUtc !== null) ?? matches[0];
  if (!normalized) return null;

  for (const { endpoint, result } of completed) {
    const raw = result.matches.find((match) => String(match.id) === normalized.providerMatchId);
    if (!raw) continue;
    const rawTime = raw.begin_at ?? raw.scheduled_at ?? null;
    return {
      providerMatchId: normalized.providerMatchId,
      endpoint,
      providerTournament: raw.league?.name?.trim()
        || raw.serie?.full_name?.trim()
        || raw.serie?.name?.trim()
        || raw.tournament?.name?.trim()
        || raw.name?.trim()
        || "赛事待定",
      providerStartTimeUtc: rawTime && !Number.isNaN(Date.parse(rawTime))
        ? new Date(rawTime).toISOString()
        : null,
      normalizedTournament: normalized.league,
      normalizedStartTimeUtc: normalized.startTimeUtc,
    };
  }
  return null;
}

export async function fetchPandaScoreGame(
  game: PandaGameKey,
  token: string,
  options: PandaFetchOptions = {},
): Promise<PandaGameSnapshot> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpointResults = await Promise.allSettled(
    pandaEndpointKeys.map(async (endpoint) => ({
      endpoint,
      result: await fetchPaginatedEndpoint(game, endpoint, token, fetchImpl, now, options),
    })),
  );

  const failed = endpointResults.filter((result) => result.status === "rejected");
  if (failed.length > 0) {
    const first = failed[0].reason;
    if (first instanceof PandaScoreRequestError) throw first;
    throw new PandaScoreRequestError(`PandaScore ${game} endpoint sync failed`, "GAME_SYNC_FAILED", null, false);
  }

  const completed = endpointResults
    .filter((result): result is PromiseFulfilledResult<{ endpoint: PandaEndpointKey; result: PaginatedEndpoint }> => result.status === "fulfilled")
    .map((result) => result.value);
  const endpointCoverage = {} as Record<PandaEndpointKey, EndpointCoverage>;
  const allNormalized: NormalizedMatch[] = [];
  let minimumRemaining: number | null = null;

  for (const { endpoint, result } of completed) {
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
      minimumRemaining = minimumRemaining === null ? result.rateLimitRemaining : Math.min(minimumRemaining, result.rateLimitRemaining);
    }
  }

  const combinedUnique = deduplicateNormalized(allNormalized);
  const finalItems = combinedUnique.filter((item) => isInEndpointWindow(item.match, item.endpoint, now));
  const matches = finalItems.map((item) => item.match);
  const statusCounts = emptyStatusCounts();
  for (const match of matches) statusCounts[match.status] += 1;
  const bounds = timeBounds(matches);
  const fetchedAt = (options.clock?.() ?? new Date()).toISOString();
  const sample = verificationSample(completed, matches);

  return {
    game,
    matches,
    fetchedAt,
    rateLimitRemaining: minimumRemaining,
    coverage: {
      endpoints: endpointCoverage,
      pages: completed.reduce((sum, item) => sum + item.result.pages, 0),
      xTotal: completed.reduce((sum, item) => sum + item.result.xTotal, 0),
      raw: completed.reduce((sum, item) => sum + item.result.matches.length, 0),
      normalized: allNormalized.length,
      deduplicated: combinedUnique.length,
      final: matches.length,
      statusCounts,
      earliestMatchAt: bounds.earliest,
      latestMatchAt: bounds.latest,
      lastSuccessfulSyncAt: fetchedAt,
      lastAttemptAt: fetchedAt,
      sourceFetchedAt: fetchedAt,
      snapshotAgeSeconds: 0,
      refreshInProgress: false,
      syncStatus: "normal",
      staleMinutes: 0,
      dataSource: "fresh",
      lastErrorCode: null,
      lastError: null,
      verificationSample: sample,
    },
  };
}

function failureFromReason(game: PandaGameKey, reason: unknown): PandaSyncFailure {
  if (reason instanceof PandaScoreRequestError) {
    return { game, code: reason.code, status: reason.status, message: reason.message };
  }
  return { game, code: "UNKNOWN", status: null, message: `PandaScore ${game} sync failed` };
}

export async function syncPandaScoreGames(
  token: string,
  previousSnapshots: Partial<Record<PandaGameKey, PandaGameSnapshot>> = {},
  options: PandaFetchOptions = {},
): Promise<PandaScoreSyncBatch> {
  const settled = await Promise.allSettled(
    pandaGameKeys.map((game) => fetchPandaScoreGame(game, token, options)),
  );
  const snapshots: Partial<Record<PandaGameKey, PandaGameSnapshot>> = { ...previousSnapshots };
  const failures: Partial<Record<PandaGameKey, PandaSyncFailure>> = {};
  const updatedGames: PandaGameKey[] = [];

  settled.forEach((result, index) => {
    const game = pandaGameKeys[index];
    if (result.status === "fulfilled") {
      const previous = previousSnapshots[game];
      if (previous && previous.matches.length > 0 && result.value.matches.length === 0) {
        failures[game] = {
          game,
          code: "EMPTY_RESULT",
          status: null,
          message: `PandaScore ${game} returned an empty result; preserved previous data`,
        };
        return;
      }
      snapshots[game] = result.value;
      updatedGames.push(game);
      return;
    }
    failures[game] = failureFromReason(game, result.reason);
  });

  return { snapshots, updatedGames, failures };
}

export function aggregatePandaScoreSnapshots(
  snapshots: Partial<Record<PandaGameKey, PandaGameSnapshot>>,
): PandaScoreResult | null {
  const available = pandaGameKeys
    .map((game) => snapshots[game])
    .filter((snapshot): snapshot is PandaGameSnapshot => !!snapshot);
  if (available.length === 0) return null;

  const unique = new Map<string, EsportsMatch>();
  for (const snapshot of available) {
    for (const match of snapshot.matches) unique.set(dedupeKey(match), match);
  }
  const matches = [...unique.values()].sort((a, b) => {
    if (!a.startTimeUtc) return 1;
    if (!b.startTimeUtc) return -1;
    return Date.parse(a.startTimeUtc) - Date.parse(b.startTimeUtc);
  });
  const fetchedAt = available
    .map((snapshot) => snapshot.fetchedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const remaining = available
    .map((snapshot) => snapshot.rateLimitRemaining)
    .filter((value): value is number => value !== null);
  const games = {} as Record<PandaGameKey, GameCoverage>;
  for (const game of pandaGameKeys) {
    if (snapshots[game]) games[game] = snapshots[game].coverage;
  }

  return {
    matches,
    fetchedAt,
    rateLimitRemaining: remaining.length > 0 ? Math.min(...remaining) : null,
    games,
    snapshots,
    totals: {
      xTotal: available.reduce((sum, item) => sum + item.coverage.xTotal, 0),
      raw: available.reduce((sum, item) => sum + item.coverage.raw, 0),
      normalized: available.reduce((sum, item) => sum + item.coverage.normalized, 0),
      deduplicated: available.reduce((sum, item) => sum + item.coverage.deduplicated, 0),
      final: matches.length,
    },
  };
}
