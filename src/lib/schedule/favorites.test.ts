import { describe, expect, it } from "vitest";
import {
  favoriteTeamKey,
  isPlaceholderTeamName,
  normalizeFavoriteTeamName,
  parseFavoriteTeams,
  toggleFavoriteTeam,
} from "./favorites";

describe("favorite teams", () => {
  it("normalizes whitespace, compatibility characters, and casing", () => {
    expect(normalizeFavoriteTeamName("  Ｔ1　 Gaming ")).toBe("t1 gaming");
    expect(favoriteTeamKey("lol", "Ｔ1 Gaming")).toBe(favoriteTeamKey("lol", "t1   gaming"));
  });

  it("keeps identically named teams from different games separate", () => {
    expect(favoriteTeamKey("lol", "Titans")).not.toBe(favoriteTeamKey("cs2", "Titans"));
  });

  it("identifies unresolved opponents without rejecting normal team names", () => {
    expect(isPlaceholderTeamName(" 待定 ")).toBe(true);
    expect(isPlaceholderTeamName("To Be Announced")).toBe(true);
    expect(isPlaceholderTeamName("T1")).toBe(false);
  });

  it("toggles a team without mutating the input list", () => {
    const empty = [] as const;
    const added = toggleFavoriteTeam([...empty], "valorant", "Paper Rex");
    expect(added).toEqual([{ game: "valorant", teamName: "Paper Rex" }]);
    expect(empty).toEqual([]);
    expect(toggleFavoriteTeam(added, "valorant", "paper rex")).toEqual([]);
  });

  it("ignores invalid and duplicate browser storage entries", () => {
    const parsed = parseFavoriteTeams(JSON.stringify([
      { game: "lol", teamName: "T1" },
      { game: "lol", teamName: " t1 " },
      { game: "not-a-game", teamName: "T1" },
      { game: "cs2", teamName: "   " },
      null,
    ]));
    expect(parsed).toEqual([{ game: "lol", teamName: "T1" }]);
  });

  it("treats malformed or non-array storage as empty", () => {
    expect(parseFavoriteTeams("{" )).toEqual([]);
    expect(parseFavoriteTeams(JSON.stringify({ game: "lol", teamName: "T1" }))).toEqual([]);
  });

  it("drops unresolved opponents from old storage and does not allow favoriting them", () => {
    expect(parseFavoriteTeams(JSON.stringify([
      { game: "lol", teamName: "待定" },
      { game: "cs2", teamName: "TBD" },
      { game: "valorant", teamName: "Paper Rex" },
    ]))).toEqual([{ game: "valorant", teamName: "Paper Rex" }]);
    const favorites = [{ game: "lol", teamName: "T1" }] as const;
    expect(toggleFavoriteTeam([...favorites], "lol", "待定")).toEqual(favorites);
  });
});
