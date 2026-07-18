import { getCache } from "@vercel/functions";
import { gameKeys } from "./schedule/types";
import type { GameKey } from "./schedule/types";

const INDEX_KEY = "pending-index-v1";
const TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_PENDING_INDEX = 200;

export type MatchSubmissionInput = {
  game: GameKey;
  league: string;
  teamA: string;
  teamB: string;
  scheduledAt: string;
  bestOf: number | null;
  sourceUrl: string;
};

type PendingSubmission = MatchSubmissionInput & {
  id: string;
  status: "pending";
  submittedAt: string;
};

function submissionCache() {
  return getCache({ namespace: "esports-schedule-submissions" });
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

export function validateSubmission(value: unknown): MatchSubmissionInput {
  if (!value || typeof value !== "object") throw new Error("提交内容格式无效");
  const input = value as Record<string, unknown>;
  if (!gameKeys.includes(input.game as GameKey)) throw new Error("请选择有效游戏");

  const league = text(input.league, 120);
  const teamA = text(input.teamA, 80);
  const teamB = text(input.teamB, 80);
  const sourceUrl = text(input.sourceUrl, 500);
  const scheduledAt = text(input.scheduledAt, 40);
  if (!league || !teamA || !teamB || !sourceUrl || !scheduledAt) {
    throw new Error("请完整填写赛事、双方、时间和来源链接");
  }

  let parsedSource: URL;
  try {
    parsedSource = new URL(sourceUrl);
  } catch {
    throw new Error("来源链接格式无效");
  }
  if (parsedSource.protocol !== "https:" && parsedSource.protocol !== "http:") {
    throw new Error("来源链接必须使用 HTTP 或 HTTPS");
  }

  const epoch = Date.parse(scheduledAt);
  if (Number.isNaN(epoch)) throw new Error("比赛时间格式无效");
  const bestOf = input.bestOf === null ? null : Number(input.bestOf);
  if (bestOf !== null && (!Number.isInteger(bestOf) || bestOf < 1 || bestOf > 9)) {
    throw new Error("赛制必须为 BO1 到 BO9，或选择未知");
  }

  return {
    game: input.game as GameKey,
    league,
    teamA,
    teamB,
    scheduledAt: new Date(epoch).toISOString(),
    bestOf,
    sourceUrl: parsedSource.toString(),
  };
}

export async function savePendingSubmission(value: unknown): Promise<PendingSubmission> {
  const input = validateSubmission(value);
  const submission: PendingSubmission = {
    ...input,
    id: crypto.randomUUID(),
    status: "pending",
    submittedAt: new Date().toISOString(),
  };
  const cache = submissionCache();
  await cache.set(`pending:${submission.id}`, submission, {
    name: "Pending match submission",
    tags: ["pending-match-submissions"],
    ttl: TTL_SECONDS,
  });

  const previous = await cache.get(INDEX_KEY);
  const ids = Array.isArray(previous)
    ? previous.filter((item): item is string => typeof item === "string")
    : [];
  await cache.set(INDEX_KEY, [submission.id, ...ids].slice(0, MAX_PENDING_INDEX), {
    name: "Pending match submission index",
    tags: ["pending-match-submissions"],
    ttl: TTL_SECONDS,
  });

  return submission;
}
