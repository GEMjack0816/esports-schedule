import { gameKeys, type GameKey } from "./types";

export type FavoriteTeam = {
  game: GameKey;
  teamName: string;
};

export function normalizeFavoriteTeamName(teamName: string): string {
  return teamName.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function favoriteTeamKey(game: GameKey, teamName: string): string {
  return JSON.stringify([game, normalizeFavoriteTeamName(teamName)]);
}

export function parseFavoriteTeams(serialized: string): FavoriteTeam[] {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return [];
  }

  if (!Array.isArray(value)) return [];

  const validGames = new Set<string>(gameKeys);
  const unique = new Map<string, FavoriteTeam>();
  for (const item of value) {
    if (
      !item
      || typeof item !== "object"
      || !("game" in item)
      || !("teamName" in item)
      || typeof item.game !== "string"
      || !validGames.has(item.game)
      || typeof item.teamName !== "string"
    ) continue;

    const teamName = item.teamName.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!teamName) continue;

    const favorite = { game: item.game as GameKey, teamName };
    const key = favoriteTeamKey(favorite.game, favorite.teamName);
    if (!unique.has(key)) unique.set(key, favorite);
  }

  return [...unique.values()].sort((left, right) =>
    favoriteTeamKey(left.game, left.teamName).localeCompare(favoriteTeamKey(right.game, right.teamName)),
  );
}

export function toggleFavoriteTeam(
  favorites: FavoriteTeam[],
  game: GameKey,
  teamName: string,
): FavoriteTeam[] {
  const normalizedName = teamName.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!normalizedName) return favorites;

  const key = favoriteTeamKey(game, normalizedName);
  if (favorites.some((favorite) => favoriteTeamKey(favorite.game, favorite.teamName) === key)) {
    return favorites.filter((favorite) => favoriteTeamKey(favorite.game, favorite.teamName) !== key);
  }

  return parseFavoriteTeams(JSON.stringify([...favorites, { game, teamName: normalizedName }]));
}
