import { createHash } from "node:crypto";
import { gameKeys } from "./schedule/types";
import type { GameKey } from "./schedule/types";
import { sanitizePublicExternalUrl, sanitizePublicHttpUrl } from "./schedule/stream-url";

export const SUBMISSION_LIMITS = {
  league: 120,
  team: 80,
  sourceUrl: 500,
  notes: 1_000,
  scheduledAt: 40,
} as const;

export type MatchSubmissionInput = {
  game: GameKey;
  league: string;
  teamA: string;
  teamB: string;
  scheduledAt: string;
  bestOf: number | null;
  sourceUrl: string;
  notes: string | null;
};

export class SubmissionValidationError extends Error {
  readonly code = "INVALID_SUBMISSION";
}

function normalizedText(value: unknown, maxLength: number, required = true): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new SubmissionValidationError("请完整填写必填字段。");
    return null;
  }
  if (typeof value !== "string") throw new SubmissionValidationError("提交内容格式无效。");
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if ((required && normalized.length === 0) || normalized.length > maxLength) {
    throw new SubmissionValidationError("字段为空或超过允许长度。");
  }
  return normalized || null;
}

function validatedUrl(value: unknown, maxLength: number, httpsOnly = false): string {
  const text = normalizedText(value, maxLength);
  let parsed: URL;
  try {
    parsed = new URL(text!);
  } catch {
    throw new SubmissionValidationError("来源链接格式无效。");
  }
  const allowed = httpsOnly ? parsed.protocol === "https:" : ["http:", "https:"].includes(parsed.protocol);
  if (!allowed) throw new SubmissionValidationError(httpsOnly ? "链接必须使用 HTTPS。" : "链接必须使用 HTTP 或 HTTPS。");
  return parsed.toString();
}

export function validateSubmission(value: unknown): MatchSubmissionInput {
  if (!value || typeof value !== "object") throw new SubmissionValidationError("提交内容格式无效。");
  const input = value as Record<string, unknown>;
  if (!gameKeys.includes(input.game as GameKey)) throw new SubmissionValidationError("请选择有效游戏。");

  const league = normalizedText(input.league, SUBMISSION_LIMITS.league)!;
  const teamA = normalizedText(input.teamA, SUBMISSION_LIMITS.team)!;
  const teamB = normalizedText(input.teamB, SUBMISSION_LIMITS.team)!;
  const notes = normalizedText(input.notes, SUBMISSION_LIMITS.notes, false);
  if (teamA.localeCompare(teamB, undefined, { sensitivity: "base" }) === 0) {
    throw new SubmissionValidationError("双方战队不能完全相同。");
  }

  const scheduledAt = normalizedText(input.scheduledAt, SUBMISSION_LIMITS.scheduledAt)!;
  const epoch = Date.parse(scheduledAt);
  if (Number.isNaN(epoch)) throw new SubmissionValidationError("比赛时间格式无效。");

  const bestOf = input.bestOf === null || input.bestOf === undefined || input.bestOf === ""
    ? null
    : Number(input.bestOf);
  if (bestOf !== null && (!Number.isInteger(bestOf) || bestOf < 1 || bestOf > 9)) {
    throw new SubmissionValidationError("赛制必须为 BO1 到 BO9，或选择未知。");
  }

  const sourceUrl = validatedUrl(input.sourceUrl, SUBMISSION_LIMITS.sourceUrl);
  if (!sanitizePublicHttpUrl(sourceUrl)) {
    throw new SubmissionValidationError("来源链接不能包含账号凭据或访问令牌。");
  }

  return {
    game: input.game as GameKey,
    league,
    teamA,
    teamB,
    scheduledAt: new Date(epoch).toISOString(),
    bestOf,
    sourceUrl,
    notes,
  };
}

function fingerprintPart(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function createSubmissionFingerprint(input: MatchSubmissionInput): string {
  const canonicalTeams = [fingerprintPart(input.teamA), fingerprintPart(input.teamB)].sort();
  const canonical = [
    input.game,
    fingerprintPart(input.league),
    ...canonicalTeams,
    new Date(input.scheduledAt).toISOString(),
  ].join("\u001f");
  return createHash("sha256").update(canonical).digest("hex");
}

export function isHoneypotHit(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = (value as Record<string, unknown>).website;
  return typeof candidate === "string" && candidate.trim().length > 0;
}

export function validateOptionalHttpsUrl(value: unknown, maxLength = 500): string | null {
  if (value === null || value === undefined || value === "") return null;
  return validatedUrl(value, maxLength, true);
}

export function validateOptionalPublicExternalUrl(value: unknown, maxLength = 500): string | null {
  const url = validateOptionalHttpsUrl(value, maxLength);
  if (url === null) return null;
  const sanitized = sanitizePublicExternalUrl(url);
  if (!sanitized) throw new SubmissionValidationError("公开链接不能包含账号凭据或访问令牌。");
  return sanitized;
}

export function validateOptionalPublicHttpUrl(value: unknown, maxLength = 500): string | null {
  if (value === null || value === undefined || value === "") return null;
  const url = validatedUrl(value, maxLength);
  const sanitized = sanitizePublicHttpUrl(url);
  if (!sanitized) throw new SubmissionValidationError("来源链接不能包含账号凭据或访问令牌。");
  return sanitized;
}

export function validateOptionalText(value: unknown, maxLength: number): string | null {
  return normalizedText(value, maxLength, false);
}
