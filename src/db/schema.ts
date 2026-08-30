import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const gameConstraint = sql`game in ('lol', 'valorant', 'honor-of-kings', 'cs2', 'dota2')`;

export const matchSubmissions = pgTable("match_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  game: text("game").notNull(),
  league: text("league").notNull(),
  teamA: text("team_a").notNull(),
  teamB: text("team_b").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }).notNull(),
  bestOf: smallint("best_of"),
  sourceUrl: text("source_url").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  fingerprint: text("fingerprint").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  reviewedBy: text("reviewed_by"),
  rejectionReason: text("rejection_reason"),
  publishedMatchId: uuid("published_match_id"),
}, (table) => [
  check("match_submissions_game_check", gameConstraint),
  check("match_submissions_status_check", sql`${table.status} in ('pending', 'approved', 'rejected')`),
  check("match_submissions_best_of_check", sql`${table.bestOf} is null or ${table.bestOf} between 1 and 9`),
  check(
    "match_submissions_distinct_teams_check",
    sql`lower(trim(${table.teamA})) <> lower(trim(${table.teamB}))`,
  ),
  check("match_submissions_source_url_check", sql`${table.sourceUrl} ~* '^https?://'`),
  uniqueIndex("match_submissions_active_fingerprint_uidx")
    .on(table.fingerprint)
    .where(sql`${table.status} in ('pending', 'approved')`),
  index("match_submissions_status_submitted_idx").on(table.status, table.submittedAt),
  index("match_submissions_game_idx").on(table.game),
]);

export const publishedManualMatches = pgTable("published_manual_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceSubmissionId: uuid("source_submission_id")
    .unique()
    .references(() => matchSubmissions.id, { onDelete: "set null" }),
  game: text("game").notNull(),
  league: text("league").notNull(),
  tournament: text("tournament"),
  stage: text("stage"),
  homeTeamName: text("home_team_name").notNull(),
  homeTeamAcronym: text("home_team_acronym"),
  homeTeamLogo: text("home_team_logo"),
  awayTeamName: text("away_team_name").notNull(),
  awayTeamAcronym: text("away_team_acronym"),
  awayTeamLogo: text("away_team_logo"),
  startTimeUtc: timestamp("start_time_utc", { withTimezone: true, mode: "date" }),
  bestOf: smallint("best_of"),
  status: text("status").notNull().default("scheduled"),
  homeScore: smallint("home_score"),
  awayScore: smallint("away_score"),
  streamUrl: text("stream_url"),
  sourceUrl: text("source_url"),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  publishedBy: text("published_by").notNull(),
  hidden: boolean("hidden").notNull().default(false),
}, (table) => [
  check("published_manual_matches_game_check", gameConstraint),
  check(
    "published_manual_matches_status_check",
    sql`${table.status} in ('scheduled', 'running', 'finished', 'postponed', 'cancelled', 'forfeit', 'unknown')`,
  ),
  check(
    "published_manual_matches_best_of_check",
    sql`${table.bestOf} is null or ${table.bestOf} between 1 and 9`,
  ),
  check(
    "published_manual_matches_distinct_teams_check",
    sql`lower(trim(${table.homeTeamName})) <> lower(trim(${table.awayTeamName}))`,
  ),
  check(
    "published_manual_matches_stream_url_check",
    sql`${table.streamUrl} is null or ${table.streamUrl} ~* '^https://'`,
  ),
  check(
    "published_manual_matches_source_url_check",
    sql`${table.sourceUrl} is null or ${table.sourceUrl} ~* '^https?://'`,
  ),
  check(
    "published_manual_matches_scores_check",
    sql`(${table.homeScore} is null or ${table.homeScore} >= 0) and (${table.awayScore} is null or ${table.awayScore} >= 0)`,
  ),
  index("published_manual_matches_visible_time_idx").on(table.hidden, table.startTimeUtc),
  index("published_manual_matches_game_idx").on(table.game),
]);

export const submissionRateLimits = pgTable("submission_rate_limits", {
  sourceHash: text("source_hash").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: "date" }).notNull(),
  requestCount: integer("request_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  check("submission_rate_limits_request_count_check", sql`${table.requestCount} >= 0`),
  index("submission_rate_limits_updated_idx").on(table.updatedAt),
]);

export const submissionRateLimitWindows = pgTable("submission_rate_limit_windows", {
  windowKey: text("window_key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: "date" }).notNull(),
  requestCount: integer("request_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  check("submission_rate_limit_windows_request_count_check", sql`${table.requestCount} >= 0`),
]);

export const pandaScoreGameSnapshots = pgTable("pandascore_game_snapshots", {
  game: text("game").primaryKey(),
  snapshotPayload: jsonb("snapshot_payload").notNull(),
  sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true, mode: "date" }).notNull(),
  lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true, mode: "date" }).notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "date" }).notNull(),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true, mode: "date" }),
  lastErrorCode: text("last_error_code"),
  lastHttpStatus: integer("last_http_status"),
  generation: uuid("generation").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, () => [
  check("pandascore_game_snapshots_game_check", gameConstraint),
]);

export const adminAuditEvents = pgTable("admin_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("admin_audit_events_created_idx").on(table.createdAt),
  index("admin_audit_events_entity_idx").on(table.entityType, table.entityId),
]);

export type MatchSubmissionRow = typeof matchSubmissions.$inferSelect;
export type NewMatchSubmissionRow = typeof matchSubmissions.$inferInsert;
export type PublishedManualMatchRow = typeof publishedManualMatches.$inferSelect;
export type NewPublishedManualMatchRow = typeof publishedManualMatches.$inferInsert;
export type AdminAuditEventRow = typeof adminAuditEvents.$inferSelect;
export type SubmissionRateLimitRow = typeof submissionRateLimits.$inferSelect;
export type SubmissionRateLimitWindowRow = typeof submissionRateLimitWindows.$inferSelect;
export type PandaScoreGameSnapshotRow = typeof pandaScoreGameSnapshots.$inferSelect;
