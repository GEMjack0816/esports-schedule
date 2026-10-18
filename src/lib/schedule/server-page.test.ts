import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { EsportsMatch, SchedulePayload } from "./types";
import { applyManualData } from "./manual";
import { createSchedulePage, parseSchedulePageQuery, SchedulePageQueryError } from "./server-page";

function match(id: string, startTimeUtc: string | null, overrides: Partial<EsportsMatch> = {}): EsportsMatch {
  return {
    id,
    provider: "pandascore",
    providerMatchId: id,
    game: "lol",
    tournament: "Spring Cup",
    league: "LCK",
    stage: "Week 1",
    homeTeam: { name: `Home ${id}`, logo: "/team-placeholder.svg" },
    awayTeam: { name: `Away ${id}`, logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc,
    streams: [],
    lastUpdatedAt: "2026-03-08T00:00:00.000Z",
    ...overrides,
  };
}

function payload(matches: EsportsMatch[]): SchedulePayload {
  return { matches } as SchedulePayload;
}

function query(overrides: Record<string, string> = {}) {
  return parseSchedulePageQuery(new URLSearchParams({ range: "all", timeZone: "UTC", ...overrides }));
}

describe("server-paginated schedule pages", () => {
  it("counts visitor-local days across the spring DST transition", () => {
    const schedule = payload([
      match("today", "2026-03-08T05:00:00.000Z"),
      match("tomorrow", "2026-03-09T04:00:00.000Z"),
      match("last-seven-day", "2026-03-14T23:00:00.000Z"),
      match("history", "2026-03-07T12:00:00.000Z"),
      match("unscheduled", null),
    ]);

    const page = createSchedulePage(schedule, query({ range: "today", timeZone: "America/New_York" }), new Date("2026-03-08T12:00:00.000Z"));

    expect(page.matches.map((item) => item.id)).toEqual(["today"]);
    expect(page.rangeCounts).toEqual({ today: 1, tomorrow: 1, seven: 3, history: 1, all: 5 });
  });

  it("applies game, status, league, and case-insensitive team/event search on the server", () => {
    const schedule = payload([
      match("kept", "2026-03-08T12:00:00.000Z", { game: "cs2", status: "running", league: "ESL", homeTeam: { name: "Aurora", logo: "" } }),
      match("wrong-game", "2026-03-08T13:00:00.000Z", { game: "lol", status: "running", league: "LCK", homeTeam: { name: "Aurora", logo: "" } }),
      match("wrong-status", "2026-03-08T14:00:00.000Z", { game: "cs2", status: "finished", league: "ESL", homeTeam: { name: "Aurora", logo: "" } }),
    ]);

    const page = createSchedulePage(schedule, query({
      range: "today", game: "cs2", status: "running", league: "ESL", q: "AURORA", timeZone: "UTC",
    }), new Date("2026-03-08T10:00:00.000Z"));

    expect(page.matches.map((item) => item.id)).toEqual(["kept"]);
    expect(page.page.total).toBe(1);
    expect(page.rangeCounts.today).toBe(3);
    expect(page.liveCount).toBe(2);
    expect(page.leagues).toEqual(["ESL", "LCK"]);
  });

  it("uses locale-independent normalized search before paginating matches", () => {
    const schedule = payload([
      match("istanbul", "2026-03-08T12:00:00.000Z", {
        homeTeam: { name: "İstanbul Wolves", logo: "" },
      }),
      match("street", "2026-03-08T13:00:00.000Z", {
        tournament: "Straße Cup",
      }),
      match("sao-paulo", "2026-03-08T14:00:00.000Z", {
        league: "São Paulo League",
      }),
    ]);

    expect(createSchedulePage(schedule, query({ q: "ISTANBUL" }), new Date("2026-03-08T00:00:00.000Z"))
      .matches.map((item) => item.id)).toEqual(["istanbul"]);
    expect(createSchedulePage(schedule, query({ q: "STRASSE" }), new Date("2026-03-08T00:00:00.000Z"))
      .matches.map((item) => item.id)).toEqual(["street"]);
    expect(createSchedulePage(schedule, query({ q: "SAO PAULO" }), new Date("2026-03-08T00:00:00.000Z"))
      .matches.map((item) => item.id)).toEqual(["sao-paulo"]);
  });

  it("keeps pagination cursors stable for equivalent normalized search queries", () => {
    const schedule = payload([
      match("street-1", "2026-03-08T12:00:00.000Z", { tournament: "Straße Cup" }),
      match("street-2", "2026-03-08T13:00:00.000Z", { tournament: "Straße Finals" }),
    ]);
    const first = createSchedulePage(
      schedule,
      query({ q: "STRASSE", limit: "1" }),
      new Date("2026-03-08T00:00:00.000Z"),
    );

    const second = createSchedulePage(
      schedule,
      query({ q: "Straße", limit: "1", cursor: first.page.nextCursor ?? "" }),
      new Date("2026-03-08T00:00:00.000Z"),
    );

    expect(first.matches.map((item) => item.id)).toEqual(["street-1"]);
    expect(second.matches.map((item) => item.id)).toEqual(["street-2"]);
  });

  it("returns stable cursor pages without duplicate or missing matches", () => {
    const schedule = payload(Array.from({ length: 7 }, (_, index) => match(
      `m${index}`,
      `2026-03-${String(index + 8).padStart(2, "0")}T12:00:00.000Z`,
    )));
    const first = createSchedulePage(schedule, query({ range: "all", limit: "3" }), new Date("2026-03-08T00:00:00.000Z"));
    const second = createSchedulePage(schedule, query({ range: "all", limit: "3", cursor: first.page.nextCursor ?? "" }), new Date("2026-03-08T00:00:00.000Z"));
    const third = createSchedulePage(schedule, query({ range: "all", limit: "3", cursor: second.page.nextCursor ?? "" }), new Date("2026-03-08T00:00:00.000Z"));

    expect([...first.matches, ...second.matches, ...third.matches].map((item) => item.id))
      .toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(third.page.nextCursor).toBeNull();
  });

  it("serves consecutive pages from a large tournament snapshot without duplicates", () => {
    const count = 3_329;
    const schedule = payload(Array.from({ length: count }, (_, index) => match(
      `match-${String(index).padStart(4, "0")}`,
      new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    )));
    const seen: string[] = [];
    const now = new Date("2026-01-01T00:00:00.000Z");
    let cursor: string | null = null;

    for (let index = 0; index < 3; index += 1) {
      const page = createSchedulePage(schedule, query({
        range: "all",
        limit: "100",
        ...(cursor ? { cursor } : {}),
      }), now);
      expect(page.page.total).toBe(count);
      seen.push(...page.matches.map((item) => item.id));
      cursor = page.page.nextCursor;
    }

    expect(seen).toHaveLength(300);
    expect(new Set(seen).size).toBe(300);
    expect(seen).toEqual(schedule.matches.slice(0, 300).map((item) => item.id));
    expect(cursor).toBeTruthy();
  });

  it("streams the cursor hash without serializing a second full match array", () => {
    const schedule = payload(Array.from({ length: 80 }, (_, index) => match(
      `hash-match-${String(index).padStart(3, "0")}`,
      new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    )));
    const stringify = vi.spyOn(JSON, "stringify");

    let resultSetHash: string;
    try {
      const page = createSchedulePage(schedule, query({ range: "all", limit: "20" }), new Date("2026-01-01T00:00:00.000Z"));
      resultSetHash = JSON.parse(Buffer.from(page.page.nextCursor ?? "", "base64url").toString("utf8"))[2];
      expect(stringify.mock.calls.some(([value]) => Array.isArray(value)
        && value.length === schedule.matches.length
        && value.every((item) => item && typeof item === "object" && "id" in item))).toBe(false);
    } finally {
      stringify.mockRestore();
    }

    const legacyCursorMatchSet = schedule.matches.map((item) => {
      const { lastUpdatedAt: freshnessOnly, ...stableMatch } = item;
      void freshnessOnly;
      return stableMatch;
    });
    const expectedHash = createHash("sha256").update(JSON.stringify(legacyCursorMatchSet)).digest("base64url");
    expect(resultSetHash!).toBe(expectedHash);
  });

  it("rejects a continuation cursor when the filtered match snapshot changed", () => {
    const original = payload(Array.from({ length: 4 }, (_, index) => match(
      `m${index}`,
      `2026-03-${String(index + 8).padStart(2, "0")}T12:00:00.000Z`,
    )));
    const first = createSchedulePage(original, query({ range: "all", limit: "2" }), new Date("2026-03-08T00:00:00.000Z"));
    const updated = payload([
      match("inserted-before-cursor", "2026-03-08T10:00:00.000Z"),
      ...original.matches,
    ]);

    try {
      createSchedulePage(updated, query({ range: "all", limit: "2", cursor: first.page.nextCursor ?? "" }), new Date("2026-03-08T00:00:00.000Z"));
      expect.fail("a cursor from the previous match set must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(SchedulePageQueryError);
      expect((error as SchedulePageQueryError).code).toBe("SCHEDULE_CHANGED");
    }
  });

  it("keeps a continuation cursor when only request-time freshness metadata changes", () => {
    const firstReadAt = new Date("2026-07-01T00:00:00.000Z");
    const nextReadAt = new Date("2026-07-01T00:00:01.000Z");
    const initial = payload(applyManualData([], firstReadAt).matches);
    const first = createSchedulePage(
      initial,
      query({ range: "all", limit: "1" }),
      firstReadAt,
    );
    const refreshed = payload(applyManualData([], nextReadAt).matches);

    expect(first.page.nextCursor).toBeTruthy();
    expect(refreshed.matches[0].lastUpdatedAt).not.toBe(initial.matches[0].lastUpdatedAt);

    const next = createSchedulePage(
      refreshed,
      query({ range: "all", limit: "1", cursor: first.page.nextCursor ?? "" }),
      nextReadAt,
    );

    expect(next.matches.map((item) => item.id)).toEqual([initial.matches[1].id]);
  });

  it("returns an empty final page instead of restarting when a cursor is beyond the last row", () => {
    const schedule = payload([
      match("early", "2026-03-08T10:00:00.000Z"),
      match("latest", "2026-03-08T12:00:00.000Z"),
    ]);
    const firstPage = createSchedulePage(schedule, query({ range: "all", limit: "1" }), new Date("2026-03-08T00:00:00.000Z"));
    const firstCursor = JSON.parse(Buffer.from(firstPage.page.nextCursor ?? "", "base64url").toString("utf8")) as [number, string, string];
    firstCursor[0] = 99;
    const cursor = Buffer.from(JSON.stringify(firstCursor)).toString("base64url");
    const page = createSchedulePage(schedule, query({ range: "all", cursor }), new Date("2026-03-08T00:00:00.000Z"));

    expect(page.matches).toEqual([]);
    expect(page.page.nextCursor).toBeNull();
  });

  it("accepts an unchanged legacy cursor during rolling deployment", () => {
    const schedule = payload([
      match("early", "2026-03-08T10:00:00.000Z"),
      match("latest", "2026-03-08T12:00:00.000Z"),
    ]);
    const firstPage = createSchedulePage(schedule, query({ range: "all", limit: "1" }), new Date("2026-03-08T00:00:00.000Z"));
    const currentCursor = JSON.parse(Buffer.from(firstPage.page.nextCursor ?? "", "base64url").toString("utf8")) as [number, string, string];
    const legacyCursor = Buffer.from(JSON.stringify({
      dateKey: "2026-03-08",
      time: Date.parse("2026-03-08T10:00:00.000Z"),
      id: "early",
      signature: JSON.stringify(["all", "UTC", "all", "all", "all", "", null]),
      resultSetHash: currentCursor[2],
    })).toString("base64url");

    const next = createSchedulePage(
      schedule,
      query({ range: "all", limit: "1", cursor: legacyCursor }),
      new Date("2026-03-08T00:00:00.000Z"),
    );

    expect(next.matches.map((item) => item.id)).toEqual(["latest"]);
  });

  it("restarts a legacy history cursor when the newest-first order changed during deployment", () => {
    const early = match("early", "2026-03-07T10:00:00.000Z");
    const late = match("late", "2026-03-07T12:00:00.000Z");
    const schedule = payload([late, early]);
    const oldOrderHash = createHash("sha256")
      .update(JSON.stringify([early, late]))
      .digest("base64url");
    const legacyCursor = Buffer.from(JSON.stringify({
      dateKey: "2026-03-07",
      time: Date.parse(early.startTimeUtc!),
      id: early.id,
      signature: JSON.stringify(["history", "UTC", "all", "all", "all", "", null]),
      resultSetHash: oldOrderHash,
    })).toString("base64url");

    try {
      createSchedulePage(
        schedule,
        query({ range: "history", timeZone: "UTC", limit: "1", cursor: legacyCursor }),
        new Date("2026-03-08T00:00:00.000Z"),
      );
      expect.fail("a cursor from the previous history order must restart pagination");
    } catch (error) {
      expect(error).toBeInstanceOf(SchedulePageQueryError);
      expect((error as SchedulePageQueryError).code).toBe("SCHEDULE_CHANGED");
    }
  });

  it("serializes only the requested slice for a large schedule", () => {
    const schedule = payload(Array.from({ length: 120 }, (_, index) => match(
      `match-${String(index).padStart(3, "0")}`,
      "2026-03-08T12:00:00.000Z",
    )));
    const page = createSchedulePage(schedule, query({ range: "all", limit: "50" }), new Date("2026-03-08T00:00:00.000Z"));

    expect(page.matches).toHaveLength(50);
    expect(page.page.total).toBe(schedule.matches.length);
    expect(page.page.nextCursor).toBeTruthy();
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(Buffer.byteLength(JSON.stringify(schedule)));
  });

  it("shows the newest history matches first, including within the same date", () => {
    const schedule = payload([
      match("mar-1-late", "2026-03-01T12:00:00.000Z"),
      match("mar-2", "2026-03-02T09:00:00.000Z"),
      match("mar-1-early", "2026-03-01T10:00:00.000Z"),
      match("unscheduled", null),
    ]);

    const page = createSchedulePage(schedule, query({ range: "history", timeZone: "UTC" }), new Date("2026-03-08T00:00:00.000Z"));

    expect(page.matches.map((item) => item.id)).toEqual(["mar-2", "mar-1-late", "mar-1-early"]);
    expect(page.rangeCounts.history).toBe(3);

    const firstPage = createSchedulePage(
      schedule,
      query({ range: "history", timeZone: "UTC", limit: "2" }),
      new Date("2026-03-08T00:00:00.000Z"),
    );
    expect(firstPage.matches.map((item) => item.id)).toEqual(["mar-2", "mar-1-late"]);
    expect(firstPage.page.nextCursor).toBeTruthy();

    const secondPage = createSchedulePage(
      schedule,
      query({ range: "history", timeZone: "UTC", limit: "2", cursor: firstPage.page.nextCursor! }),
      new Date("2026-03-08T00:00:00.000Z"),
    );
    expect(secondPage.matches.map((item) => item.id)).toEqual(["mar-1-early"]);
  });

  it("lets an explicit date override the shortcut and rejects a cursor from other filters", () => {
    const schedule = payload([
      match("march-8", "2026-03-08T12:00:00.000Z"),
      match("march-9", "2026-03-09T12:00:00.000Z"),
    ]);
    const datePage = createSchedulePage(schedule, query({ range: "history", date: "2026-03-09" }), new Date("2026-03-10T00:00:00.000Z"));
    const cursorPage = createSchedulePage(schedule, query({ range: "all", limit: "1" }), new Date("2026-03-10T00:00:00.000Z"));

    expect(datePage.matches.map((item) => item.id)).toEqual(["march-9"]);
    expect(() => createSchedulePage(schedule, query({ range: "history", date: "2026-03-09", cursor: cursorPage.page.nextCursor ?? "" }), new Date("2026-03-10T00:00:00.000Z")))
      .toThrow(SchedulePageQueryError);
  });

  it("clamps page size, bounds search input, and rejects invalid date/timezone values", () => {
    expect(query({ limit: "500" }).limit).toBe(100);
    expect(() => query({ q: "x".repeat(121) })).toThrow(SchedulePageQueryError);
    expect(() => query({ date: "2026-02-30" })).toThrow(SchedulePageQueryError);
    expect(() => query({ timeZone: "Not/A_Timezone" })).toThrow(SchedulePageQueryError);
  });

  it("keeps cursors within the request limit for maximum valid search filters", () => {
    const search = "x".repeat(120);
    const league = "L".repeat(160);
    const schedule = payload([
      match("long-filter-1", "2026-03-08T12:00:00.000Z", {
        league,
        homeTeam: { name: search, logo: "" },
      }),
      match("long-filter-2", "2026-03-08T13:00:00.000Z", {
        league,
        homeTeam: { name: search, logo: "" },
      }),
    ]);
    const filters = { range: "all", limit: "1", q: search, league, timeZone: "UTC" };
    const first = createSchedulePage(schedule, query(filters), new Date("2026-03-08T00:00:00.000Z"));
    const cursor = first.page.nextCursor;

    expect(cursor).toBeTruthy();
    expect(cursor!.length).toBeLessThanOrEqual(512);
    const next = createSchedulePage(
      schedule,
      parseSchedulePageQuery(new URLSearchParams({ ...filters, cursor: cursor! })),
      new Date("2026-03-08T00:00:00.000Z"),
    );
    expect(next.matches.map((item) => item.id)).toEqual(["long-filter-2"]);
  });
});

