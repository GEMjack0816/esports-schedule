import type {
  EsportsMatch,
  GameKey,
  MatchStatus,
  Stream,
  Team,
} from "./types";

const PANDASCORE_API = "https://api.pandascore.co";

type PandaOpponent = {
  opponent?: {
    name?: string | null;
    acronym?: string | null;
    image_url?: string | null;
  } | null;
};

type PandaResult = {
  score?: number | null;
  team_id?: number | null;
};

type PandaStream = {
  language?: string | null;
  main?: boolean;
  official?: boolean;
  raw_url?: string | null;
  embed_url?: string | null;
};

type PandaMatch = {
  id?: number;
  name?: string | null;
  scheduled_at?: string | null;
  begin_at?: string | null;
  end_at?: string | null;
  status?: string | null;
  number_of_games?: number | null;
  match_type?: string | null;
  opponents?: PandaOpponent[];
  results?: PandaResult[];
  streams_list?: PandaStream[];
  league?: { name?: string | null } | null;
  tournament?: { name?: string | null } | null;
  videogame?: { slug?: string | null; name?: string | null } | null;
  modified_at?: string | null;
};

const gameSlugMap: Record<string, GameKey> = {
  league_of_legends: "lol",
  "league-of-legends": "lol",
  lol: "lol",
  valorant: "valorant",
  csgo: "cs2",
  "counter-strike": "cs2",
  dota2: "dota2",
  "dota-2": "dota2",
};

function mapGame(match: PandaMatch): GameKey | null {
  const raw = match.videogame?.slug?.toLowerCase();
  if (raw && gameSlugMap[raw]) return gameSlugMap[raw];

  const name = match.videogame?.name?.toLowerCase() ?? "";
  if (name.includes("league of legends")) return "lol";
  if (name.includes("valorant")) return "valorant";
  if (name.includes("counter-strike")) return "cs2";
  if (name.includes("dota 2")) return "dota2";
  return null;
}

function mapStatus(status?: string | null): MatchStatus {
  if (status === "running") return "running";
  if (status === "finished") return "finished";
  if (status === "canceled") return "canceled";
  if (status === "postponed") return "postponed";
  return "upcoming";
}

function mapTeam(opponent: PandaOpponent | undefined, fallback: string): Team {
  return {
    name: opponent?.opponent?.name || fallback,
    acronym: opponent?.opponent?.acronym || null,
    logo: opponent?.opponent?.image_url || null,
  };
}

function mapStreams(streams: PandaStream[] | undefined): Stream[] {
  return (streams ?? [])
    .map((stream) => ({
      label: stream.language?.toUpperCase() || (stream.main ? "主直播" : "直播"),
      url: stream.raw_url || stream.embed_url || "",
      official: stream.official,
    }))
    .filter((stream) => stream.url.startsWith("https://"));
}

function inferBestOf(match: PandaMatch): number {
  if (match.number_of_games && match.number_of_games > 0) {
    return match.number_of_games;
  }
  const parsed = Number(match.match_type?.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function mapMatch(match: PandaMatch): EsportsMatch | null {
  const game = mapGame(match);
  const scheduledAt = match.scheduled_at || match.begin_at;
  if (!game || !match.id || !scheduledAt) return null;

  const scoreA = match.results?.[0]?.score;
  const scoreB = match.results?.[1]?.score;

  return {
    id: `pandascore-${match.id}`,
    game,
    scheduledAt,
    teams: [
      mapTeam(match.opponents?.[0], "待定战队 A"),
      mapTeam(match.opponents?.[1], "待定战队 B"),
    ],
    league: match.league?.name || "未公布赛事",
    tournament: match.tournament?.name || null,
    bestOf: inferBestOf(match),
    scores: [scoreA ?? null, scoreB ?? null],
    status: mapStatus(match.status),
    streams: mapStreams(match.streams_list),
    source: "pandascore",
    updatedAt: match.modified_at || new Date().toISOString(),
  };
}

async function fetchEndpoint(
  endpoint: "upcoming" | "running" | "past",
  token: string,
): Promise<PandaMatch[]> {
  const url = new URL(`/matches/${endpoint}`, PANDASCORE_API);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("sort", endpoint === "past" ? "-scheduled_at" : "scheduled_at");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    next: { revalidate: 300, tags: ["pandascore-fixtures"] },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`PandaScore ${endpoint} failed (${response.status}): ${detail.slice(0, 160)}`);
  }

  return (await response.json()) as PandaMatch[];
}

export async function getPandaScoreMatches(token: string): Promise<EsportsMatch[]> {
  const results = await Promise.allSettled([
    fetchEndpoint("upcoming", token),
    fetchEndpoint("running", token),
    fetchEndpoint("past", token),
  ]);

  const successful = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  if (successful.length === 0) {
    const reasons = results
      .filter((result) => result.status === "rejected")
      .map((result) => (result as PromiseRejectedResult).reason)
      .join("; ");
    throw new Error(reasons || "PandaScore returned no fixtures");
  }

  const deduplicated = new Map<string, EsportsMatch>();
  for (const match of successful) {
    const mapped = mapMatch(match);
    if (mapped) deduplicated.set(mapped.id, mapped);
  }

  return [...deduplicated.values()];
}
