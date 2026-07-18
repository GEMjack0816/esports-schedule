import { getDemoMatches } from "./demo";
import { getHonorOfKingsMatches } from "./manual";
import { getPandaScoreMatches } from "./pandascore";
import type { EsportsMatch, SchedulePayload } from "./types";

function uniqueAndSort(matches: EsportsMatch[]): EsportsMatch[] {
  const unique = new Map<string, EsportsMatch>();
  for (const match of matches) unique.set(match.id, match);
  return [...unique.values()].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );
}

export async function getSchedule(): Promise<SchedulePayload> {
  const generatedAt = new Date().toISOString();
  const token = process.env.PANDASCORE_TOKEN?.trim();
  const honorOfKings = getHonorOfKingsMatches();

  if (!token) {
    return {
      matches: uniqueAndSort([...getDemoMatches(), ...honorOfKings]),
      generatedAt,
      mode: "demo",
      providers: {
        pandascore: "not-configured",
        honorOfKings: "manual-json",
      },
      warning: "PandaScore Token 尚未配置，当前展示演示赛程与王者荣耀人工数据。",
    };
  }

  try {
    const pandaMatches = await getPandaScoreMatches(token);
    return {
      matches: uniqueAndSort([...pandaMatches, ...honorOfKings]),
      generatedAt,
      mode: "live",
      providers: {
        pandascore: "connected",
        honorOfKings: "manual-json",
      },
    };
  } catch (error) {
    console.error("[schedule] PandaScore fixtures unavailable", error);
    return {
      matches: uniqueAndSort([...getDemoMatches(), ...honorOfKings]),
      generatedAt,
      mode: "demo",
      providers: {
        pandascore: "error",
        honorOfKings: "manual-json",
      },
      warning: "PandaScore 暂时不可用，已自动切换到演示赛程。",
    };
  }
}

export type { EsportsMatch, GameKey, MatchStatus, SchedulePayload } from "./types";
