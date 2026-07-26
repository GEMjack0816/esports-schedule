import type {
  AdminAuditEventRow,
  MatchSubmissionRow,
  PublishedManualMatchRow,
} from "@/db/schema";
import type { GameKey, MatchStatus } from "@/lib/schedule";
import type { MatchSubmissionInput } from "@/lib/submissions";

export type SubmissionStatus = "pending" | "approved" | "rejected";

export type SubmissionListFilters = {
  status?: SubmissionStatus;
  game?: GameKey;
  query?: string;
  sort?: "newest" | "oldest";
  page: number;
  pageSize: number;
};

export type PublishedMatchWrite = {
  game: GameKey;
  league: string;
  tournament: string | null;
  stage: string | null;
  homeTeamName: string;
  homeTeamAcronym: string | null;
  homeTeamLogo: string | null;
  awayTeamName: string;
  awayTeamAcronym: string | null;
  awayTeamLogo: string | null;
  startTimeUtc: string | null;
  bestOf: number | null;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  streamUrl: string | null;
  sourceUrl: string | null;
};

export type ApprovalInput = {
  submission: MatchSubmissionInput;
  published: PublishedMatchWrite;
};

export type AdminSummary = {
  pending: number;
  today: number;
  approved: number;
  rejected: number;
  publishedManualMatches: number;
  recentEvents: AdminAuditEventRow[];
};

export type SubmissionPage = {
  rows: MatchSubmissionRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type ManualMatchPage = {
  rows: PublishedManualMatchRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type SubmissionCounts = {
  pending: number;
  approved: number;
  rejected: number;
  publishedManualMatches: number;
};

export type LegacyInsertResult = "imported" | "duplicate";

export class ReviewConflictError extends Error {
  readonly code = "REVIEW_CONFLICT";
}

export class ReviewNotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

export class DuplicateSubmissionError extends Error {
  readonly code = "DUPLICATE_SUBMISSION";
}

export class DatabaseUnavailableError extends Error {
  readonly code = "DATABASE_UNAVAILABLE";
}
