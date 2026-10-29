import type { EsportsMatch } from "@/lib/schedule/types";

export type MatchShareLabels = {
  game: string;
  status: string;
  localStartTime: string;
  localTimeZone: string;
  siteUrl: string;
};

function cleanLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Build a safe, human-readable match share payload without provider URLs or query state. */
export function buildMatchShareText(match: EsportsMatch, labels: MatchShareLabels): string {
  const event = [match.league, match.tournament, match.stage]
    .map((value) => value ? cleanLine(value) : "")
    .filter(Boolean)
    .join(" · ");
  const score = match.homeScore !== null && match.awayScore !== null
    ? `比分：${match.homeScore}–${match.awayScore}`
    : null;

  return [
    `${labels.game} · ${event || "赛事待更新"}`,
    `${cleanLine(match.homeTeam.name)} vs ${cleanLine(match.awayTeam.name)}`,
    `时间（${labels.localTimeZone}）：${labels.localStartTime}`,
    `赛制：${match.bestOf ? `BO${match.bestOf}` : "待定"}`,
    score,
    `状态：${labels.status}`,
    `赛程：${labels.siteUrl}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}
