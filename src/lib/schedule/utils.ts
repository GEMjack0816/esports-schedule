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
        ...match,
        homeTeam: sanitizePublicTeam(match.homeTeam),
        awayTeam: sanitizePublicTeam(match.awayTeam),
        streams: sanitizePublicStreams(match.streams),
        sourceUrl: sanitizePublicHttpUrl(match.sourceUrl),
      });
    }
  }
  return [...unique.values()].sort((a, b) => {
    if (!a.startTimeUtc) return 1;
    if (!b.startTimeUtc) return -1;
    return Date.parse(a.startTimeUtc) - Date.parse(b.startTimeUtc);
  });
}
