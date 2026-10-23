import type { EsportsMatch } from "./types";
import {
  sanitizePublicHttpUrl,
  sanitizePublicStreams,
  sanitizePublicTeam,
} from "./stream-url";

export function matchProviderKey(match: EsportsMatch): string {
  return `${match.provider}:${match.providerMatchId}`;
}

export function uniqueAndSort(matches: EsportsMatch[]): EsportsMatch[] {
  const unique = new Map<string, EsportsMatch>();
  for (const match of matches) {
    const key = matchProviderKey(match);
    const previous = unique.get(key);
    if (!previous || match.manualOverride || Date.parse(match.lastUpdatedAt) >= Date.parse(previous.lastUpdatedAt)) {
      unique.set(key, {
        id: match.id,
        provider: match.provider,
        providerMatchId: match.providerMatchId,
        game: match.game,
        tournament: match.tournament,
        league: match.league,
        stage: match.stage,
        homeTeam: sanitizePublicTeam(match.homeTeam),
        awayTeam: sanitizePublicTeam(match.awayTeam),
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        bestOf: match.bestOf,
        status: match.status,
        startTimeUtc: match.startTimeUtc,
        streams: sanitizePublicStreams(match.streams),
        lastUpdatedAt: match.lastUpdatedAt,
        sourceUrl: sanitizePublicHttpUrl(match.sourceUrl),
        ...(typeof match.manualOverride === "boolean" ? { manualOverride: match.manualOverride } : {}),
      });
    }
  }
  return [...unique.values()].sort((a, b) => {
    if (!a.startTimeUtc) return 1;
    if (!b.startTimeUtc) return -1;
    return Date.parse(a.startTimeUtc) - Date.parse(b.startTimeUtc);
  });
}
