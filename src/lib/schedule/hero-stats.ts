import type { EsportsMatch } from "./types";

export const UPCOMING_HERO_WINDOW_MS = 24 * 60 * 60 * 1_000;

export function getScheduleHeroStats(matches: EsportsMatch[], nowMs: number): {
  liveCount: number;
  upcomingCount: number;
} {
  const nextDayEnd = nowMs + UPCOMING_HERO_WINDOW_MS;
  let liveCount = 0;
  let upcomingCount = 0;

  for (const match of matches) {
    if (match.status === "running") {
      liveCount += 1;
      continue;
    }

    if (match.status !== "scheduled" || !match.startTimeUtc) continue;
    const startTime = Date.parse(match.startTimeUtc);
    if (Number.isFinite(startTime) && startTime > nowMs && startTime <= nextDayEnd) {
      upcomingCount += 1;
    }
  }

  return { liveCount, upcomingCount };
}
