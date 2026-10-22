import type { EsportsMatch } from "./types";

type StreamMatchContext = Pick<EsportsMatch, "league" | "tournament" | "stage" | "homeTeam" | "awayTeam">;
export type StreamActionLabel = "立即观看" | "直播入口";

export function getStreamLinkAccessibleName(action: StreamActionLabel, match: StreamMatchContext): string {
  const eventContext = [match.league, match.tournament, match.stage].filter(Boolean).join("，");
  return `${action}：${eventContext}，${match.homeTeam.name} 对阵 ${match.awayTeam.name}`;
}
