import type { EsportsMatch } from "./types";

export function uniqueAndSort(matches: EsportsMatch[]): EsportsMatch[] {
  const unique = new Map<string, EsportsMatch>();
  for (const match of matches) unique.set(match.id, match);
  return [...unique.values()].sort(
    (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
  );
}
