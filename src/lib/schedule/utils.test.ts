import { describe, expect, it } from "vitest";
import { uniqueAndSort } from "./utils";
import type { EsportsMatch } from "./types";

describe("public schedule projection", () => {
  it("drops unknown credential-bearing fields from matches and nested objects", () => {
    const match = {
      id: "pandascore:lol:42",
      provider: "pandascore",
      providerMatchId: "42",
      game: "lol",
      tournament: "Summer Split",
      league: "League",
      stage: null,
      homeTeam: {
        name: "Alpha",
        acronym: "ALP",
        logo: "/team-placeholder.svg",
        accessToken: "match-user-token",
      },
      awayTeam: { name: "Beta", logo: "/team-placeholder.svg", clientSecret: "team-secret" },
      homeScore: null,
      awayScore: null,
      bestOf: 3,
      status: "scheduled",
      startTimeUtc: "2026-10-24T12:00:00.000Z",
      streams: [{
        label: "Official",
        url: "https://stream.example/live",
        official: true,
        authorization: "stream-auth",
      }],
      lastUpdatedAt: "2026-10-23T12:00:00.000Z",
      sourceUrl: null,
      refreshToken: "top-level-refresh-token",
      internalMetadata: { credential: "nested-credential" },
    } as unknown as EsportsMatch;

    const [publicMatch] = uniqueAndSort([match]);

    expect(publicMatch).toMatchObject({
      id: "pandascore:lol:42",
      homeTeam: { name: "Alpha", acronym: "ALP" },
      awayTeam: { name: "Beta" },
      streams: [{ label: "Official", url: "https://stream.example/live", official: true }],
    });
    expect(JSON.stringify(publicMatch)).not.toMatch(/match-user-token|team-secret|stream-auth|top-level-refresh-token|nested-credential/);
    expect(publicMatch).not.toHaveProperty("internalMetadata");
    expect(publicMatch.homeTeam).not.toHaveProperty("accessToken");
    expect(publicMatch.awayTeam).not.toHaveProperty("clientSecret");
    expect(publicMatch.streams[0]).not.toHaveProperty("authorization");
  });
});
