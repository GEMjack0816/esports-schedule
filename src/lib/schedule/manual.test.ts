import { describe, expect, it } from "vitest";
import { applyManualData, applyManualOverrides } from "./manual";
import type { EsportsMatch } from "./types";

function match(providerMatchId: string): EsportsMatch {
  return {
    id: `pandascore:lol:${providerMatchId}`,
    provider: "pandascore",
    providerMatchId,
    game: "lol",
    tournament: "Season",
    league: "League",
    stage: "Round 1",
    homeTeam: { name: "Old A", acronym: null, logo: "/team-placeholder.svg" },
    awayTeam: { name: "Old B", acronym: null, logo: "/team-placeholder.svg" },
    homeScore: null,
    awayScore: null,
    bestOf: 3,
    status: "scheduled",
    startTimeUtc: "2026-07-20T00:00:00.000Z",
    streams: [],
    lastUpdatedAt: "2026-07-18T00:00:00.000Z",
  };
}

describe("manual corrections", () => {
  it("applies approved changes after API data and can add a missing stream", () => {
    const result = applyManualOverrides([match("1")], [{
      id: "fix-1",
      provider: "pandascore",
      providerMatchId: "1",
      game: "lol",
      reviewStatus: "approved",
      changes: {
        startTimeUtc: "2026-07-20T02:00:00.000Z",
        status: "postponed",
        homeTeam: { name: "Correct A" },
        streams: [{ label: "官方直播", url: "https://example.com/live", official: true }],
      },
    }], new Date("2026-07-18T03:00:00.000Z"));

    expect(result.matches[0]).toMatchObject({
      startTimeUtc: "2026-07-20T02:00:00.000Z",
      status: "postponed",
      manualOverride: true,
      homeTeam: { name: "Correct A" },
    });
    expect(result.matches[0].streams).toHaveLength(1);
  });

  it("hides an approved bad match and ignores pending overrides", () => {
    const result = applyManualOverrides([match("1"), match("2")], [
      {
        id: "hide-1",
        provider: "pandascore",
        providerMatchId: "1",
        game: "lol",
        reviewStatus: "approved",
        hidden: true,
      },
      {
        id: "pending-2",
        provider: "pandascore",
        providerMatchId: "2",
        game: "lol",
        reviewStatus: "pending",
        hidden: true,
      },
    ]);

    expect(result.hiddenCount).toBe(1);
    expect(result.matches.map((item) => item.providerMatchId)).toEqual(["2"]);
  });

  it("keeps approved Honor of Kings manual fixtures when API fixtures are synchronized", () => {
    const apiMatch: EsportsMatch = {
      ...match("kog-api-1"),
      id: "pandascore:honor-of-kings:kog-api-1",
      game: "honor-of-kings",
    };
    const result = applyManualData([apiMatch], new Date("2026-07-18T00:00:00.000Z"));

    expect(result.honorOfKingsCount).toBe(3);
    expect(result.matches.some((item) => item.providerMatchId === "kog-api-1")).toBe(true);
    expect(result.matches.filter((item) => item.provider === "manual" && item.game === "honor-of-kings")).toHaveLength(3);
  });
});
