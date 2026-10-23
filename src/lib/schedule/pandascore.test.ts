import { describe, expect, it } from "vitest";
import {
  apiGamePaths,
  buildPandaEndpointUrl,
  fetchPaginatedEndpoint,
  fetchPandaScoreGame,
  getUtcCoverageWindow,
  normalizePandaMatch,
  syncPandaScoreGames,
  type PandaGameSnapshot,
  type PandaMatch,
} from "./pandascore";
import { dateKeyInTimeZone } from "./time";
import { pandaGameKeys, type EsportsMatch, type GameCoverage, type PandaGameKey } from "./types";
import { uniqueAndSort } from "./utils";

function response(items: PandaMatch[], headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(items), {
    status: 200,
    headers: { "x-total": String(items.length), "x-page": "1", "x-per-page": "100", ...headers },
  });
}

function baseMatch(overrides: Partial<EsportsMatch> = {}): EsportsMatch {
  return {
    id: "pandascore:lol:1",
    provider: "pandascore",
    providerMatchId: "1",
    game: "lol",
    tournament: "Test Season",
    league: "Test League",
    stage: "Round 1",
    homeTeam: { name: "A", acronym: "A", logo: "/team-placeholder.svg" },
    awayTeam: { name: "B", acronym: "B", logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc: "2026-07-20T00:00:00.000Z",
    streams: [],
    lastUpdatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

function emptyCoverage(): GameCoverage {
  const endpoint = {
    pages: 1,
    xTotal: 1,
    raw: 1,
    normalized: 1,
    deduplicated: 1,
    final: 1,
    filtered: { missingId: 0, missingTime: 0, invalidTime: 0, outsideWindow: 0, duplicate: 0 },
  };
  return {
    endpoints: { upcoming: endpoint, running: endpoint, past: endpoint },
    pages: 3,
    xTotal: 3,
    raw: 3,
    normalized: 3,
    deduplicated: 1,
    final: 1,
    statusCounts: { scheduled: 1, running: 0, finished: 0, postponed: 0, cancelled: 0, forfeit: 0, unknown: 0 },
    earliestMatchAt: "2026-07-20T00:00:00.000Z",
    latestMatchAt: "2026-07-20T00:00:00.000Z",
    lastSuccessfulSyncAt: "2026-07-18T00:00:00.000Z",
    lastAttemptAt: "2026-07-18T00:00:00.000Z",
    sourceFetchedAt: "2026-07-18T00:00:00.000Z",
    snapshotAgeSeconds: 0,
    refreshInProgress: false,
    syncStatus: "normal",
    staleMinutes: 0,
    dataSource: "fresh",
    lastErrorCode: null,
    lastError: null,
  };
}

function snapshot(game: PandaGameKey): PandaGameSnapshot {
  return {
    game,
    matches: [baseMatch({ id: `pandascore:${game}:1`, game })],
    fetchedAt: "2026-07-18T00:00:00.000Z",
    rateLimitRemaining: 900,
    coverage: emptyCoverage(),
  };
}

describe("PandaScore endpoint configuration", () => {
  it("configures all five games with their official API slugs", () => {
    expect(pandaGameKeys).toEqual(["lol", "valorant", "honor-of-kings", "cs2", "dota2"]);
    expect(apiGamePaths).toEqual({
      lol: "lol",
      valorant: "valorant",
      "honor-of-kings": "kog",
      cs2: "csgo",
      dota2: "dota2",
    });
  });

  it("sorts past newest-first and upcoming oldest-first", () => {
    const now = new Date("2026-07-18T00:00:00.000Z");
    expect(buildPandaEndpointUrl("lol", "past", 1, now).searchParams.get("sort")).toBe("-begin_at");
    expect(buildPandaEndpointUrl("lol", "upcoming", 1, now).searchParams.get("sort")).toBe("begin_at");
    expect(buildPandaEndpointUrl("lol", "running", 1, now).pathname).toBe("/lol/matches/running");
  });
});

describe("PandaScore pagination and retry", () => {
  it("bypasses the Next Data Cache during an authoritative source sync", async () => {
    let requestInit: RequestInit | undefined;
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      requestInit = init;
      return response([]);
    };
    await fetchPaginatedEndpoint(
      "lol",
      "running",
      "test-token",
      fetchImpl as typeof fetch,
      new Date("2026-07-18T00:00:00.000Z"),
    );
    expect(requestInit?.cache).toBe("no-store");
  });

  it("follows rel=next, requests 100 per page, and matches X-Total", async () => {
    const calls: URL[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push(url);
      const page = Number(url.searchParams.get("page"));
      if (page === 1) {
        return response(Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })), {
          "x-total": "101",
          link: `<${url.origin}${url.pathname}?page=2>; rel="next"`,
        });
      }
      return response([{ id: 101 }], { "x-total": "101", "x-page": "2" });
    };

    const result = await fetchPaginatedEndpoint(
      "lol",
      "upcoming",
      "test-token",
      fetchImpl as typeof fetch,
      new Date("2026-07-18T00:00:00.000Z"),
    );

    expect(result.pages).toBe(2);
    expect(result.matches).toHaveLength(101);
    expect(result.xTotal).toBe(101);
    expect(calls.every((url) => url.searchParams.get("per_page") === "100")).toBe(true);
  });

  it("retries a temporary 429 and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      return response([]);
    };
    await expect(fetchPaginatedEndpoint(
      "valorant",
      "running",
      "test-token",
      fetchImpl as typeof fetch,
      new Date("2026-07-18T00:00:00.000Z"),
      { sleep: async () => undefined },
    )).resolves.toMatchObject({ pages: 1, xTotal: 0 });
    expect(calls).toBe(2);
  });

  it("rejects incomplete pagination when raw count differs from X-Total", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const page = Number(url.searchParams.get("page"));
      return response(page === 1 ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) : [], {
        "x-total": "101",
        "x-page": String(page),
      });
    };
    await expect(fetchPaginatedEndpoint(
      "cs2",
      "past",
      "test-token",
      fetchImpl as typeof fetch,
      new Date("2026-07-18T00:00:00.000Z"),
    )).rejects.toThrow("pagination mismatch");
  });

  it("accepts a changing total across separate sync runs without hard-coded counts", async () => {
    let total = 1;
    const fetchImpl = async () => response(
      Array.from({ length: total }, (_, index) => ({ id: index + 1 })),
      { "x-total": String(total) },
    );
    const now = new Date("2026-07-18T00:00:00.000Z");
    await expect(fetchPaginatedEndpoint("dota2", "running", "test-token", fetchImpl as typeof fetch, now))
      .resolves.toMatchObject({ xTotal: 1 });
    total = 2;
    await expect(fetchPaginatedEndpoint("dota2", "running", "test-token", fetchImpl as typeof fetch, now))
      .resolves.toMatchObject({ xTotal: 2 });
  });
});

describe("PandaScore normalization", () => {
  it("keeps TBD opponents, defaults missing logos, and falls back to scheduled_at", () => {
    const outcome = normalizePandaMatch({
      id: 42,
      begin_at: null,
      scheduled_at: "2026-07-20T12:00:00+08:00",
      opponents: [],
      streams_list: [],
      number_of_games: null,
      results: [],
    }, "valorant", "upcoming", new Date("2026-07-18T00:00:00.000Z"));

    expect(outcome.reason).toBeNull();
    expect(outcome.match?.startTimeUtc).toBe("2026-07-20T04:00:00.000Z");
    expect([outcome.match?.homeTeam.name, outcome.match?.awayTeam.name]).toEqual(["待定", "待定"]);
    expect(outcome.match?.homeTeam.logo).toBe("/team-placeholder.svg");
    expect(outcome.match?.bestOf).toBeNull();
    expect(outcome.match?.homeScore).toBeNull();
    expect(outcome.match?.streams).toEqual([]);
  });

  it("retains a match with no known start time without crashing", () => {
    const outcome = normalizePandaMatch({ id: 43, begin_at: null, scheduled_at: null }, "dota2", "upcoming");
    expect(outcome.match?.startTimeUtc).toBeNull();
    expect(outcome.match?.homeTeam.name).toBe("待定");
  });

  it("syncs a recently finished match from the past endpoint", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/past")) {
        expect(url.searchParams.get("sort")).toBe("-begin_at");
        return response([{ id: 88, begin_at: "2026-07-18T11:00:00.000Z", status: "finished" }]);
      }
      return response([]);
    };
    const result = await fetchPandaScoreGame("lol", "test-token", {
      now,
      clock: () => new Date("2026-07-18T12:00:30.000Z"),
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.fetchedAt).toBe("2026-07-18T12:00:30.000Z");
    expect(result.matches[0]).toMatchObject({ providerMatchId: "88", status: "finished" });
    expect(result.coverage.verificationSample).toMatchObject({
      providerMatchId: "88",
      endpoint: "past",
      providerStartTimeUtc: "2026-07-18T11:00:00.000Z",
      normalizedStartTimeUtc: "2026-07-18T11:00:00.000Z",
    });
  });

  it("keeps the running endpoint version when the same match also has a newer scheduled copy", async () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/upcoming")) {
        return response([{
          id: 99,
          begin_at: "2026-07-18T11:00:00.000Z",
          status: "not_started",
          modified_at: "2026-07-18T11:59:00.000Z",
        }]);
      }
      if (url.pathname.endsWith("/running")) {
        return response([{
          id: 99,
          begin_at: "2026-07-18T11:00:00.000Z",
          status: "running",
          modified_at: "2026-07-18T11:58:00.000Z",
        }]);
      }
      return response([]);
    };

    const result = await fetchPandaScoreGame("lol", "test-token", {
      now,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].status).toBe("running");
    expect(result.coverage.statusCounts.running).toBe(1);
  });
});

describe("per-game failure isolation", () => {
  it("accepts an empty provider result only when no last-known-good snapshot exists", async () => {
    const batch = await syncPandaScoreGames("test-token", {}, {
      now: new Date("2026-07-18T00:00:00.000Z"),
      fetchImpl: (async () => response([])) as typeof fetch,
    });
    expect(batch.updatedGames).toEqual(pandaGameKeys);
    expect(batch.failures).toEqual({});
    for (const game of pandaGameKeys) expect(batch.snapshots[game]?.matches).toEqual([]);
  });

  it("keeps one failed game's prior snapshot while other games update", async () => {
    const previous = Object.fromEntries(pandaGameKeys.map((game) => [game, snapshot(game)]));
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.startsWith("/kog/")) return new Response("failed", { status: 500 });
      const endpoint = url.pathname.split("/").at(-1);
      const beginAt = endpoint === "past"
        ? "2026-07-17T00:00:00.000Z"
        : endpoint === "running"
          ? "2026-07-18T00:00:00.000Z"
          : "2026-07-19T00:00:00.000Z";
      return response([{ id: endpoint === "past" ? 3 : endpoint === "running" ? 2 : 1, begin_at: beginAt }]);
    };
    const batch = await syncPandaScoreGames("test-token", previous, {
      now: new Date("2026-07-18T00:00:00.000Z"),
      fetchImpl: fetchImpl as typeof fetch,
      maxRetries: 0,
      sleep: async () => undefined,
    });
    expect(batch.failures["honor-of-kings"]?.code).toBe("UPSTREAM");
    expect(batch.snapshots["honor-of-kings"]).toBe(previous["honor-of-kings"]);
    expect(batch.updatedGames).toEqual(expect.arrayContaining(["lol", "valorant", "cs2", "dota2"]));
  });

  it("does not replace a non-empty old snapshot with an empty API result", async () => {
    const previous = Object.fromEntries(pandaGameKeys.map((game) => [game, snapshot(game)]));
    const fetchImpl = async () => response([]);
    const batch = await syncPandaScoreGames("test-token", previous, {
      now: new Date("2026-07-18T00:00:00.000Z"),
      fetchImpl: fetchImpl as typeof fetch,
    });
    for (const game of pandaGameKeys) {
      expect(batch.failures[game]?.code).toBe("EMPTY_RESULT");
      expect(batch.snapshots[game]).toBe(previous[game]);
    }
    expect(batch.updatedGames).toEqual([]);
  });
});

describe("UTC ranges, time zones, and provider deduplication", () => {
  it("builds an exact UTC window of 30 past days and 60 future days", () => {
    const range = getUtcCoverageWindow(new Date("2026-07-18T00:00:00.000Z"));
    expect(range.pastStart.toISOString()).toBe("2026-06-18T00:00:00.000Z");
    expect(range.futureEnd.toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });

  it("places the same UTC match on the correct local date across midnight", () => {
    const value = "2026-07-18T16:30:00.000Z";
    expect(dateKeyInTimeZone(value, "Asia/Shanghai")).toBe("2026-07-19");
    expect(dateKeyInTimeZone(value, "America/Los_Angeles")).toBe("2026-07-18");
  });

  it("deduplicates by provider and providerMatchId", () => {
    const older = baseMatch({ id: "old", lastUpdatedAt: "2026-07-18T00:00:00.000Z" });
    const newer = baseMatch({ id: "new", lastUpdatedAt: "2026-07-18T01:00:00.000Z" });
    const manual = baseMatch({ id: "manual", provider: "manual", game: "cs2" });
    const result = uniqueAndSort([older, newer, manual]);
    expect(result).toHaveLength(2);
    expect(result.find((match) => match.provider === "pandascore")?.id).toBe("new");
  });

  it("removes credentialed stream URLs before matches enter public schedule results", () => {
    const result = uniqueAndSort([baseMatch({
      streams: [
        { label: "private", url: "https://stream.example/live?access_token=secret" },
        { label: "public", url: "https://stream.example/live" },
      ],
    })]);
    expect(result[0]?.streams).toEqual([{ label: "public", url: "https://stream.example/live" }]);
  });
});
