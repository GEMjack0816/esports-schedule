import type { EsportsMatch } from "@/lib/schedule/types";

export type MatchShareLabels = {
  game: string;
  status: string;
  localStartTime: string;
  siteUrl: string;
};

/** Build a safe, human-readable match share payload without provider URLs or query state. */
export function buildMatchShareText(match: EsportsMatch, labels: MatchShareLabels): string {
  const event = [match.league, match.tournament, match.stage].filter(Boolean).join(" · ");
  const score = match.homeScore !== null && match.awayScore !== null
    ? `比分：${match.homeScore}–${match.awayScore}`
    : null;

  return [
    `${labels.game} · ${event || "赛事待更新"}`,
    `${match.homeTeam.name} vs ${match.awayTeam.name}`,
    `时间：${labels.localStartTime}`,
    `赛制：${match.bestOf ? `BO${match.bestOf}` : "待定"}`,
    score,
    `状态：${labels.status}`,
    `赛程：${labels.siteUrl}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}
