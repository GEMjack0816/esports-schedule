import "server-only";

import { createHash } from "node:crypto";
import { addDaysKey, dateKeyInTimeZone } from "./time";
import type { EsportsMatch, GameKey, MatchStatus, SchedulePayload } from "./types";
import type {
  SchedulePageData,
  SchedulePageQuery,
  SchedulePageQueryFilters,
  ScheduleRangeKey,
} from "./page-types";

export const DEFAULT_SCHEDULE_PAGE_SIZE = 50;
export const MAX_SCHEDULE_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 120;
const MAX_LEAGUE_LENGTH = 160;
const MAX_CURSOR_LENGTH = 512;

const ranges = new Set<ScheduleRangeKey>(["today", "tomorrow", "seven", "history", "all"]);
const games = new Set<GameKey>(["lol", "valorant", "honor-of-kings", "cs2", "dota2"]);
const statuses = new Set<MatchStatus>([
  "scheduled", "running", "finished", "postponed", "cancelled", "forfeit", "unknown",
]);

type MatchOrderKey = {
  dateKey: string;
  time: number | null;
  id: string;
};

type LegacyCursor = MatchOrderKey & {
  signature: string;
  resultSetHash: string;
};

type DecodedCursor =
  | { kind: "offset"; offset: number }
  | { kind: "legacy"; key: MatchOrderKey };

export class SchedulePageQueryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SchedulePageQueryError";
  }
}

function validDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString().slice(0, 10) === value;
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function parseEnum<T extends string>(value: string | null, allowed: Set<T>, fallback: T): T {
  if (value === null || value === "all") return fallback;
  if (!allowed.has(value as T)) throw new SchedulePageQueryError("INVALID_FILTER");
  return value as T;
}

export function parseSchedulePageQuery(params: URLSearchParams): SchedulePageQuery {
  const rangeValue = params.get("range") ?? "today";
  if (!ranges.has(rangeValue as ScheduleRangeKey)) throw new SchedulePageQueryError("INVALID_RANGE");

  const timeZone = params.get("timeZone") ?? "UTC";
  if (timeZone.length > 100 || !validTimeZone(timeZone)) throw new SchedulePageQueryError("INVALID_TIME_ZONE");

  const selectedDateValue = params.get("date");
  if (selectedDateValue && !validDateKey(selectedDateValue)) throw new SchedulePageQueryError("INVALID_DATE");

  const rawLimit = params.get("limit");
  const parsedLimit = rawLimit === null ? DEFAULT_SCHEDULE_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) throw new SchedulePageQueryError("INVALID_LIMIT");

  const query = (params.get("q") ?? "").trim();
  const league = (params.get("league") ?? "all").trim();
  if (query.length > MAX_SEARCH_LENGTH || league.length > MAX_LEAGUE_LENGTH) {
    throw new SchedulePageQueryError("FILTER_TOO_LONG");
  }

  const cursor = params.get("cursor");
  if (cursor && cursor.length > MAX_CURSOR_LENGTH) throw new SchedulePageQueryError("INVALID_CURSOR");

  return {
    range: rangeValue as ScheduleRangeKey,
    timeZone,
    game: parseEnum(params.get("game"), games, "all"),
    league: league || "all",
    status: parseEnum(params.get("status"), statuses, "all"),
    query,
    selectedDate: selectedDateValue,
    cursor,
    limit: Math.min(parsedLimit, MAX_SCHEDULE_PAGE_SIZE),
  };
}
function normalizedQuery(filters: SchedulePageQueryFilters): string {
  return JSON.stringify([
    filters.range,
    filters.timeZone,
    filters.game,
    filters.league,
    filters.status,
    filters.query.trim().toLocaleLowerCase("zh-CN"),
    filters.selectedDate,
  ]);
}

function querySignature(filters: SchedulePageQueryFilters): string {
  return createHash("sha256").update(normalizedQuery(filters)).digest("base64url");
}

function dateKeys(now: Date, timeZone: string) {
  const today = dateKeyInTimeZone(now, timeZone);
  // Use calendar arithmetic rather than adding 24-hour durations so DST days
  // do not shift the tomorrow/seven-day boundaries.
  return {
    today,
    tomorrow: addDaysKey(1, "UTC", Date.parse(`${today}T00:00:00.000Z`)),
    sevenDaysOut: addDaysKey(6, "UTC", Date.parse(`${today}T00:00:00.000Z`)),
  };
}

function matchDateKey(match: EsportsMatch, timeZone: string): string {
  if (!match.startTimeUtc) return "unscheduled";
  const time = Date.parse(match.startTimeUtc);
  return Number.isNaN(time) ? "unscheduled" : dateKeyInTimeZone(new Date(time), timeZone);
}

function isInRange(key: string, filters: SchedulePageQueryFilters, dates: ReturnType<typeof dateKeys>): boolean {
  if (filters.selectedDate) return key === filters.selectedDate;
  switch (filters.range) {
    case "today": return key === dates.today;
    case "tomorrow": return key === dates.tomorrow;
    case "seven": return key >= dates.today && key <= dates.sevenDaysOut;
    case "history": return key !== "unscheduled" && key < dates.today;
    case "all": return true;
  }
}

function searchText(match: EsportsMatch): string {
  return [match.homeTeam.name, match.awayTeam.name, match.league, match.tournament ?? "", match.stage ?? ""]
    .join(" ")
    .toLocaleLowerCase("zh-CN");
}

function compareMatchKeys(
  first: MatchOrderKey,
  second: MatchOrderKey,
  range: ScheduleRangeKey,
): number {
  if (first.dateKey !== second.dateKey) {
    if (first.dateKey === "unscheduled") return 1;
    if (second.dateKey === "unscheduled") return -1;
    return range === "history"
      ? second.dateKey.localeCompare(first.dateKey)
      : first.dateKey.localeCompare(second.dateKey);
  }
  const timeOrder = (first.time ?? Number.MAX_SAFE_INTEGER) - (second.time ?? Number.MAX_SAFE_INTEGER);
  return (range === "history" ? -timeOrder : timeOrder) || first.id.localeCompare(second.id);
}

function toCursor(
  match: EsportsMatch,
  timeZone: string,
  dateKey = matchDateKey(match, timeZone),
): MatchOrderKey {
  const parsed = match.startTimeUtc ? Date.parse(match.startTimeUtc) : Number.NaN;
  return {
    dateKey,
    time: Number.isNaN(parsed) ? null : parsed,
    id: match.id,
  };
}

function encodeCursor(offset: number, signature: string, resultSetHash: string): string {
  return Buffer.from(JSON.stringify([offset, signature, resultSetHash])).toString("base64url");
}

function decodeCursor(
  value: string,
  signature: string,
  legacySignature: string,
  resultSetHash: string,
): DecodedCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(parsed)) {
      if (parsed.length !== 3
        || !Number.isSafeInteger(parsed[0])
        || (parsed[0] as number) < 0
        || parsed[1] !== signature
        || typeof parsed[2] !== "string"
        || !/^[A-Za-z0-9_-]{43}$/.test(parsed[2])) {
        throw new Error("invalid cursor");
      }
      if (parsed[2] !== resultSetHash) throw new SchedulePageQueryError("SCHEDULE_CHANGED");
      return { kind: "offset", offset: parsed[0] as number };
    }

    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor");
    const legacy = parsed as Partial<LegacyCursor>;
    if (typeof legacy.dateKey !== "string"
      || (legacy.dateKey !== "unscheduled" && !validDateKey(legacy.dateKey))
      || (legacy.time !== null && (typeof legacy.time !== "number" || !Number.isFinite(legacy.time)))
      || typeof legacy.id !== "string"
      || legacy.id.length > 240
      || typeof legacy.resultSetHash !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(legacy.resultSetHash)
      || legacy.signature !== legacySignature) throw new Error("invalid cursor");
    if (legacy.resultSetHash !== resultSetHash) throw new SchedulePageQueryError("SCHEDULE_CHANGED");
    return {
      kind: "legacy",
      key: { dateKey: legacy.dateKey, time: legacy.time ?? null, id: legacy.id },
    };
  } catch (error) {
    if (error instanceof SchedulePageQueryError) throw error;
    throw new SchedulePageQueryError("INVALID_CURSOR");
  }
}

export function createSchedulePage(
  payload: SchedulePayload,
  query: SchedulePageQuery,
  now = new Date(),
): SchedulePageData {
  const filters: SchedulePageQueryFilters = {
    range: query.range,
    timeZone: query.timeZone,
    game: query.game,
    league: query.league,
    status: query.status,
    query: query.query,
    selectedDate: query.selectedDate,
    limit: query.limit,
  };
  const dates = dateKeys(now, query.timeZone);
  const rangeCounts: SchedulePageData["rangeCounts"] = { today: 0, tomorrow: 0, seven: 0, history: 0, all: payload.matches.length };
  const leagues = [...new Set(payload.matches.map((match) => match.league))].sort((a, b) => a.localeCompare(b));
  let liveCount = 0;
  let upcomingCount = 0;

  const matchingEntries: Array<{ match: EsportsMatch; cursor: MatchOrderKey }> = [];
  const legacySignature = normalizedQuery(filters);
  const signature = querySignature(filters);
  for (const match of payload.matches) {
    const key = matchDateKey(match, query.timeZone);
    if (key === dates.today) rangeCounts.today += 1;
    if (key === dates.tomorrow) rangeCounts.tomorrow += 1;
    if (key >= dates.today && key <= dates.sevenDaysOut) rangeCounts.seven += 1;
    if (key !== "unscheduled" && key < dates.today) rangeCounts.history += 1;
    if (match.status === "running") liveCount += 1;
    if (match.status === "scheduled") upcomingCount += 1;

    const matchesFilters = isInRange(key, filters, dates)
      && (filters.game === "all" || match.game === filters.game)
      && (filters.league === "all" || match.league === filters.league)
      && (filters.status === "all" || match.status === filters.status)
      && (!filters.query.trim() || searchText(match).includes(filters.query.trim().toLocaleLowerCase("zh-CN")));
    if (matchesFilters) {
      matchingEntries.push({
        match,
        cursor: toCursor(match, query.timeZone, key),
      });
    }
  }

  matchingEntries.sort((first, second) => compareMatchKeys(first.cursor, second.cursor, query.range));
  // `lastUpdatedAt` is freshness metadata, not match-set identity. Static
  // manual JSON matches receive a request-time fallback timestamp, so hashing
  // it would invalidate every continuation cursor even when visible schedule
  // content is unchanged.
  // Stream the exact JSON array bytes into the digest. This preserves cursor
  // hashes across rolling deployments while avoiding a second array plus one
  // full-schedule JSON string on every page request.
  const resultSetHashDigest = createHash("sha256").update("[");
  matchingEntries.forEach(({ match }, index) => {
    if (index > 0) resultSetHashDigest.update(",");
    const { lastUpdatedAt: freshnessOnly, ...stableMatch } = match;
    void freshnessOnly;
    resultSetHashDigest.update(JSON.stringify(stableMatch));
  });
  const resultSetHash = resultSetHashDigest.update("]").digest("base64url");

  const cursor = query.cursor
    ? decodeCursor(query.cursor, signature, legacySignature, resultSetHash)
    : null;
  const cursorIndex = !cursor
    ? 0
    : cursor.kind === "offset"
      ? cursor.offset
      : matchingEntries.findIndex((entry) => compareMatchKeys(entry.cursor, cursor.key, query.range) > 0);
  const startIndex = cursorIndex < 0 ? matchingEntries.length : cursorIndex;
  const selected = matchingEntries.slice(startIndex, startIndex + query.limit);
  const matches = selected.map((entry) => entry.match);
  const hasMore = startIndex + selected.length < matchingEntries.length;

  return {
    ...payload,
    matches,
    page: {
      limit: query.limit,
      nextCursor: hasMore
        ? encodeCursor(startIndex + selected.length, signature, resultSetHash)
        : null,
      total: matchingEntries.length,
    },
    rangeCounts,
    liveCount,
    upcomingCount,
    leagues,
    timeZone: query.timeZone,
  };
}

