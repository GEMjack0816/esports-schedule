import "server-only";

import { revalidateTag } from "next/cache";
import { gameKeys } from "@/lib/schedule/types";
import type { GameKey, MatchStatus } from "@/lib/schedule/types";
import { normalizeStoredMatchStatus } from "@/lib/schedule/status";
import {
  SubmissionValidationError,
  validateOptionalHttpUrl,
  validateOptionalHttpsUrl,
  validateOptionalText,
  validateSubmission,
} from "@/lib/submissions";
import type { MatchSubmissionInput } from "@/lib/submissions";
import { getReviewRepository } from "./repository";
import type { DrizzleReviewRepository } from "./repository";
import type {
  ApprovalInput,
  PublishedMatchWrite,
  SubmissionListFilters,
  SubmissionStatus,
} from "./types";

export const PUBLISHED_MANUAL_MATCHES_TAG = "published-manual-matches";

export function invalidatePublishedManualMatches(): void {
  revalidateTag(PUBLISHED_MANUAL_MATCHES_TAG, "max");
}

function integerOrNull(value: unknown, min: number, max: number, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new SubmissionValidationError(`${label}格式无效。`);
  }
  return parsed;
}

function timeOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new SubmissionValidationError("比赛时间格式无效。");
  }
  return new Date(value).toISOString();
}

function requiredText(value: unknown, maxLength: number, label: string): string {
  const result = validateOptionalText(value, maxLength);
  if (!result) throw new SubmissionValidationError(`${label}不能为空。`);
  return result;
}

export function validatePublishedMatch(value: unknown): PublishedMatchWrite {
  if (!value || typeof value !== "object") throw new SubmissionValidationError("人工比赛格式无效。");
  const input = value as Record<string, unknown>;
  if (!gameKeys.includes(input.game as GameKey)) throw new SubmissionValidationError("请选择有效游戏。");
  const homeTeamName = requiredText(input.homeTeamName, 80, "主队");
  const awayTeamName = requiredText(input.awayTeamName, 80, "客队");
  if (homeTeamName.localeCompare(awayTeamName, undefined, { sensitivity: "base" }) === 0) {
    throw new SubmissionValidationError("双方战队不能完全相同。");
  }
  const rawStatus = typeof input.status === "string" ? input.status : "scheduled";
  const status = normalizeStoredMatchStatus(rawStatus);
  if (!status) throw new SubmissionValidationError("比赛状态无效。");
  return {
    game: input.game as GameKey,
    league: requiredText(input.league, 120, "赛事"),
    tournament: validateOptionalText(input.tournament, 120),
    stage: validateOptionalText(input.stage, 120),
    homeTeamName,
    homeTeamAcronym: validateOptionalText(input.homeTeamAcronym, 20),
    homeTeamLogo: validateOptionalHttpsUrl(input.homeTeamLogo),
    awayTeamName,
    awayTeamAcronym: validateOptionalText(input.awayTeamAcronym, 20),
    awayTeamLogo: validateOptionalHttpsUrl(input.awayTeamLogo),
    startTimeUtc: timeOrNull(input.startTimeUtc),
    bestOf: integerOrNull(input.bestOf, 1, 9, "BO 赛制"),
    status: status as MatchStatus,
    homeScore: integerOrNull(input.homeScore, 0, 999, "主队比分"),
    awayScore: integerOrNull(input.awayScore, 0, 999, "客队比分"),
    streamUrl: validateOptionalHttpsUrl(input.streamUrl),
    sourceUrl: validateOptionalHttpUrl(input.sourceUrl),
  };
}

export function approvalFromRequest(value: unknown): ApprovalInput {
  if (!value || typeof value !== "object") throw new SubmissionValidationError("审核内容格式无效。");
  const body = value as Record<string, unknown>;
  return {
    submission: validateSubmission(body.submission),
    published: validatePublishedMatch(body.published),
  };
}

export function defaultPublishedFromSubmission(input: MatchSubmissionInput): PublishedMatchWrite {
  return {
    game: input.game,
    league: input.league,
    tournament: null,
    stage: null,
    homeTeamName: input.teamA,
    homeTeamAcronym: null,
    homeTeamLogo: null,
    awayTeamName: input.teamB,
    awayTeamAcronym: null,
    awayTeamLogo: null,
    startTimeUtc: input.scheduledAt,
    bestOf: input.bestOf,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    streamUrl: null,
    sourceUrl: input.sourceUrl,
  };
}

export function validateRejectionReason(value: unknown): string {
  const reason = validateOptionalText(value, 500);
  if (!reason) throw new SubmissionValidationError("驳回时必须填写理由。");
  return reason;
}

export function parseSubmissionFilters(searchParams: URLSearchParams): SubmissionListFilters {
  const statusValue = searchParams.get("status");
  const status = ["pending", "approved", "rejected"].includes(statusValue ?? "")
    ? statusValue as SubmissionStatus
    : undefined;
  const gameValue = searchParams.get("game");
  const game = gameKeys.includes(gameValue as GameKey) ? gameValue as GameKey : undefined;
  const query = validateOptionalText(searchParams.get("q"), 120) ?? undefined;
  const page = Math.max(1, Math.min(10_000, Number(searchParams.get("page")) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(searchParams.get("pageSize")) || 25));
  return {
    status,
    game,
    query,
    sort: searchParams.get("sort") === "oldest" ? "oldest" : "newest",
    page,
    pageSize,
  };
}

export async function approveAndPublish(
  id: string,
  value: unknown,
  actorId: string,
  repository: DrizzleReviewRepository = getReviewRepository(),
  invalidate: () => void = invalidatePublishedManualMatches,
) {
  const result = await repository.approveSubmission(id, approvalFromRequest(value), actorId);
  invalidate();
  return result;
}

export async function createManualMatch(
  value: unknown,
  actorId: string,
  repository: DrizzleReviewRepository = getReviewRepository(),
  invalidate: () => void = invalidatePublishedManualMatches,
) {
  const result = await repository.createManualMatch(validatePublishedMatch(value), actorId);
  invalidate();
  return result;
}

export async function updateManualMatch(
  id: string,
  value: unknown,
  actorId: string,
  repository: DrizzleReviewRepository = getReviewRepository(),
  invalidate: () => void = invalidatePublishedManualMatches,
) {
  const result = await repository.updateManualMatch(id, validatePublishedMatch(value), actorId);
  invalidate();
  return result;
}

export async function setManualMatchHidden(
  id: string,
  hidden: boolean,
  actorId: string,
  repository: DrizzleReviewRepository = getReviewRepository(),
  invalidate: () => void = invalidatePublishedManualMatches,
) {
  const result = await repository.setManualMatchHidden(id, hidden, actorId);
  invalidate();
  return result;
}

export async function toggleManualMatchHidden(
  id: string,
  actorId: string,
  repository: DrizzleReviewRepository = getReviewRepository(),
  invalidate: () => void = invalidatePublishedManualMatches,
) {
  const result = await repository.toggleManualMatchHidden(id, actorId);
  invalidate();
  return result;
}
