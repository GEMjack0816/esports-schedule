import { describe, expect, it } from "vitest";
import {
  fetchPaginatedEndpoint,
  getUtcCoverageWindow,
  normalizePandaMatch,
  type PandaMatch,
} from "./pandascore";
import { dateKeyInTimeZone } from "./time";
import { uniqueAndSort } from "./utils";
import type { EsportsMatch } from "./types";

function response(items: PandaMatch[], headers: Record<string, string>) {
  return new Response(JSON.stringify(items), { status: 200, headers });
}

describe("PandaScore pagination", () => {
  it("follows rel=next, requests 100 per page, and matches X-Total", async () => {
    const calls: URL[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push(url);
      const page = Number(url.searchParams.get("page"));
      if (page === 1) {
        return response(Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })), {
          "x-total": "101",
          "x-page": "1",
          "x-per-page": "100",
          link: `<${url.origin}${url.pathname}?page=2>; rel="next"`,
        });
      }
      return response([{ id: 101 }], {
        "x-total": "101",
        "x-page": "2",
        "x-per-page": "100",
      });
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
    expect(calls[0].searchParams.get("sort")).toBe("begin_at");
  });

  it("rejects incomplete pagination when raw count differs from X-Total", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const page = Number(url.searchParams.get("page"));
      return response(page === 1 ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) : [], {
        "x-total": "101",
        "x-page": String(page),
        "x-per-page": "100",
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
});

describe("PandaScore normalization", () => {
  it("keeps TBD opponents and falls back from empty begin_at to scheduled_at", () => {
    const outcome = normalizePandaMatch({
      id: 42,
      begin_at: null,
      scheduled_at: "2026-07-20T12:00:00+08:00",
      opponents: [],
      streams_list: [],
      number_of_games: null,
    }, "valorant", "upcoming", new Date("2026-07-18T00:00:00.000Z"));

    expect(outcome.reason).toBeNull();
    expect(outcome.match?.scheduledAt).toBe("2026-07-20T04:00:00.000Z");
    expect(outcome.match?.teams.map((team) => team.name)).toEqual(["待定", "待定"]);
    expect(outcome.match?.bestOf).toBeNull();
    expect(outcome.match?.streams).toEqual([]);
  });

  it("uses videogame and match id as the unique key", () => {
    const raw = { id: 7, begin_at: "2026-07-20T00:00:00.000Z" };
    const lol = normalizePandaMatch(raw, "lol", "upcoming").match;
    const cs2 = normalizePandaMatch(raw, "cs2", "upcoming").match;
    expect(lol?.id).toBe("pandascore:lol:7");
    expect(cs2?.id).toBe("pandascore:cs2:7");
    expect(lol?.id).not.toBe(cs2?.id);
  });
});

describe("UTC ranges and visitor time zones", () => {
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
});

describe("deduplication", () => {
  it("does not collapse different ids even when teams and date are identical", () => {
    const base: EsportsMatch = {
      id: "pandascore:lol:1",
      game: "lol",
      scheduledAt: "2026-07-20T00:00:00.000Z",
      teams: [{ name: "A" }, { name: "B" }],
      league: "Test",
      bestOf: 3,
      scores: [null, null],
      status: "upcoming",
      streams: [],
      source: "pandascore",
      updatedAt: "2026-07-18T00:00:00.000Z",
    };
    const result = uniqueAndSort([base, { ...base, id: "pandascore:lol:2" }]);
    expect(result).toHaveLength(2);
  });
});
