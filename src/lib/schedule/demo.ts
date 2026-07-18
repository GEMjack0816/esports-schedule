import type { EsportsMatch, GameKey, MatchStatus } from "./types";

type DemoSeed = {
  id: string;
  game: GameKey;
  hourOffset: number;
  teams: [string, string];
  league: string;
  tournament: string;
  bestOf: number;
  status: MatchStatus;
  scores?: [number, number];
  stream?: string;
};

const seeds: DemoSeed[] = [
  {
    id: "lol-lpl",
    game: "lol",
    hourOffset: 2,
    teams: ["Bilibili Gaming", "Top Esports"],
    league: "LPL",
    tournament: "夏季赛 · 常规赛",
    bestOf: 3,
    status: "upcoming",
    stream: "https://www.twitch.tv/lpl",
  },
  {
    id: "valorant-vct",
    game: "valorant",
    hourOffset: -1,
    teams: ["Paper Rex", "Gen.G"],
    league: "VCT Pacific",
    tournament: "Stage 2 · Playoffs",
    bestOf: 3,
    status: "running",
    scores: [1, 0],
    stream: "https://www.twitch.tv/valorant",
  },
  {
    id: "cs2-blast",
    game: "cs2",
    hourOffset: 7,
    teams: ["Vitality", "Spirit"],
    league: "BLAST Premier",
    tournament: "Fall Groups",
    bestOf: 3,
    status: "upcoming",
    stream: "https://www.twitch.tv/blastpremier",
  },
  {
    id: "dota-riyadh",
    game: "dota2",
    hourOffset: 24,
    teams: ["Team Liquid", "Gaimin Gladiators"],
    league: "Riyadh Masters",
    tournament: "Group Stage",
    bestOf: 2,
    status: "upcoming",
    stream: "https://www.twitch.tv/dota2",
  },
  {
    id: "hok-kpl-demo",
    game: "honor-of-kings",
    hourOffset: 27,
    teams: ["成都AG超玩会", "重庆狼队"],
    league: "KPL 夏季赛",
    tournament: "常规赛",
    bestOf: 5,
    status: "upcoming",
    stream: "https://pvp.qq.com/match/",
  },
  {
    id: "lol-lck",
    game: "lol",
    hourOffset: 72,
    teams: ["T1", "Hanwha Life Esports"],
    league: "LCK",
    tournament: "Regular Season",
    bestOf: 3,
    status: "upcoming",
    stream: "https://www.twitch.tv/lck",
  },
  {
    id: "valorant-emea",
    game: "valorant",
    hourOffset: 120,
    teams: ["FNATIC", "Team Heretics"],
    league: "VCT EMEA",
    tournament: "Stage 2",
    bestOf: 3,
    status: "upcoming",
    stream: "https://www.twitch.tv/valorant_emea",
  },
  {
    id: "cs2-past",
    game: "cs2",
    hourOffset: -25,
    teams: ["Natus Vincere", "MOUZ"],
    league: "IEM Cologne",
    tournament: "Group A",
    bestOf: 3,
    status: "finished",
    scores: [2, 1],
  },
  {
    id: "dota-past",
    game: "dota2",
    hourOffset: -51,
    teams: ["PARIVISION", "BetBoom Team"],
    league: "DreamLeague",
    tournament: "Playoffs",
    bestOf: 3,
    status: "finished",
    scores: [1, 2],
  },
];

export function getDemoMatches(): EsportsMatch[] {
  const now = Date.now();
  const updatedAt = new Date(now).toISOString();

  return seeds.map((seed) => ({
    id: `demo-${seed.id}`,
    provider: "demo" as const,
    providerMatchId: seed.id,
    game: seed.game,
    startTimeUtc: new Date(now + seed.hourOffset * 60 * 60 * 1000).toISOString(),
    homeTeam: { name: seed.teams[0], acronym: seed.teams[0].split(" ").map((word) => word[0]).join("").slice(0, 4), logo: "/team-placeholder.svg" },
    awayTeam: { name: seed.teams[1], acronym: seed.teams[1].split(" ").map((word) => word[0]).join("").slice(0, 4), logo: "/team-placeholder.svg" },
    league: seed.league,
    tournament: seed.tournament,
    stage: null,
    bestOf: seed.bestOf,
    homeScore: seed.scores?.[0] ?? null,
    awayScore: seed.scores?.[1] ?? null,
    status: seed.status,
    streams: seed.stream
      ? [{ label: "官方直播", url: seed.stream, official: true }]
      : [],
    lastUpdatedAt: updatedAt,
  }));
}
