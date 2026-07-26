import { describe, expect, it } from "vitest";
import type { PublishedManualMatchRow } from "@/db/schema";
import {
  preserveLastSuccessfulPublicMatches,
  publishedRowToMatch,
} from "./public-matches";

function row(overrides: Partial<PublishedManualMatchRow> = {}): PublishedManualMatchRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sourceSubmissionId: null,
    game: "honor-of-kings",
    league: "KPL",
    tournament: "Summer",
    stage: null,
    homeTeamName: "Alpha",
    homeTeamAcronym: null,
    homeTeamLogo: null,
    awayTeamName: "Beta",
    awayTeamAcronym: null,
    awayTeamLogo: null,
    startTimeUtc: new Date("2026-08-01T00:00:00.000Z"),
    bestOf: 5,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    streamUrl: null,
    sourceUrl: "https://example.com/source",
    publishedAt: new Date("2026-07-26T00:00:00.000Z"),
    updatedAt: new Date("2026-07-26T01:00:00.000Z"),
    publishedBy: "user_1",
    hidden: false,
    ...overrides,
  };
}

describe("published database manual matches", () => {
  it("uses a stable manual provider key and safe local logo fallback", () => {
    const match = publishedRowToMatch(row());
    expect(match.id).toBe("manual:honor-of-kings:db-11111111-1111-4111-8111-111111111111");
    expect(match.providerMatchId).toBe("db-11111111-1111-4111-8111-111111111111");
    expect(match.homeTeam.logo).toBe("/team-placeholder.svg");
    expect(match.awayTeam.logo).toBe("/team-placeholder.svg");
  });

  it("publishes only a validated HTTPS stream supplied by the database layer", () => {
    const match = publishedRowToMatch(row({ streamUrl: "https://live.example/match" }));
    expect(match.streams).toEqual([{
      label: "直播",
      url: "https://live.example/match",
      official: false,
    }]);
  });

  it("returns the last successful public snapshot when the database read fails", async () => {
    const cached = {
      matches: [publishedRowToMatch(row())],
      fetchedAt: "2026-07-26T01:00:00.000Z",
    };
    const result = await preserveLastSuccessfulPublicMatches(
      async () => {
        throw new Error("database unavailable");
      },
      async () => cached,
    );
    expect(result).toEqual({ value: cached, fallback: true });
  });

  it("does not read fallback data after a successful database read", async () => {
    const current = {
      matches: [publishedRowToMatch(row())],
      fetchedAt: "2026-07-26T02:00:00.000Z",
    };
    let fallbackRead = false;
    const result = await preserveLastSuccessfulPublicMatches(
      async () => current,
      async () => {
        fallbackRead = true;
        return null;
      },
    );
    expect(result).toEqual({ value: current, fallback: false });
    expect(fallbackRead).toBe(false);
  });
});
