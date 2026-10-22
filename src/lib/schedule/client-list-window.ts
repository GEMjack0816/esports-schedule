export const MATCH_RENDER_BATCH_SIZE = 200;

export type MatchListWindow = {
  filterKey: string;
  limit: number;
};

export function resetMatchListWindow(): MatchListWindow {
  return { filterKey: "", limit: MATCH_RENDER_BATCH_SIZE };
}

export function visibleMatchLimit(window: MatchListWindow, filterKey: string): number {
  return window.filterKey === filterKey ? window.limit : MATCH_RENDER_BATCH_SIZE;
}

export function nextMatchLimit(current: number, total: number): number {
  return Math.min(total, current + MATCH_RENDER_BATCH_SIZE);
}

export function windowMatches<T>(matches: T[], limit: number, newestWindow: boolean): T[] {
  return newestWindow
    ? matches.slice(Math.max(0, matches.length - limit))
    : matches.slice(0, limit);
}
