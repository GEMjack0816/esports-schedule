CREATE TABLE "admin_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" text NOT NULL,
	"league" text NOT NULL,
	"team_a" text NOT NULL,
	"team_b" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"best_of" smallint,
	"source_url" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"fingerprint" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"rejection_reason" text,
	"published_match_id" uuid,
	CONSTRAINT "match_submissions_game_check" CHECK (game in ('lol', 'valorant', 'honor-of-kings', 'cs2', 'dota2')),
	CONSTRAINT "match_submissions_status_check" CHECK ("match_submissions"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "match_submissions_best_of_check" CHECK ("match_submissions"."best_of" is null or "match_submissions"."best_of" between 1 and 9),
	CONSTRAINT "match_submissions_distinct_teams_check" CHECK (lower(trim("match_submissions"."team_a")) <> lower(trim("match_submissions"."team_b"))),
	CONSTRAINT "match_submissions_source_url_check" CHECK ("match_submissions"."source_url" ~* '^https?://')
);
--> statement-breakpoint
CREATE TABLE "published_manual_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_submission_id" uuid,
	"game" text NOT NULL,
	"league" text NOT NULL,
	"tournament" text,
	"stage" text,
	"home_team_name" text NOT NULL,
	"home_team_acronym" text,
	"home_team_logo" text,
	"away_team_name" text NOT NULL,
	"away_team_acronym" text,
	"away_team_logo" text,
	"start_time_utc" timestamp with time zone,
	"best_of" smallint,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"home_score" smallint,
	"away_score" smallint,
	"stream_url" text,
	"source_url" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "published_manual_matches_source_submission_id_unique" UNIQUE("source_submission_id"),
	CONSTRAINT "published_manual_matches_game_check" CHECK (game in ('lol', 'valorant', 'honor-of-kings', 'cs2', 'dota2')),
	CONSTRAINT "published_manual_matches_status_check" CHECK ("published_manual_matches"."status" in ('scheduled', 'running', 'finished', 'postponed', 'cancelled', 'forfeit', 'unknown')),
	CONSTRAINT "published_manual_matches_best_of_check" CHECK ("published_manual_matches"."best_of" is null or "published_manual_matches"."best_of" between 1 and 9),
	CONSTRAINT "published_manual_matches_distinct_teams_check" CHECK (lower(trim("published_manual_matches"."home_team_name")) <> lower(trim("published_manual_matches"."away_team_name"))),
	CONSTRAINT "published_manual_matches_stream_url_check" CHECK ("published_manual_matches"."stream_url" is null or "published_manual_matches"."stream_url" ~* '^https://'),
	CONSTRAINT "published_manual_matches_source_url_check" CHECK ("published_manual_matches"."source_url" is null or "published_manual_matches"."source_url" ~* '^https?://'),
	CONSTRAINT "published_manual_matches_scores_check" CHECK (("published_manual_matches"."home_score" is null or "published_manual_matches"."home_score" >= 0) and ("published_manual_matches"."away_score" is null or "published_manual_matches"."away_score" >= 0))
);
--> statement-breakpoint
ALTER TABLE "published_manual_matches" ADD CONSTRAINT "published_manual_matches_source_submission_id_match_submissions_id_fk" FOREIGN KEY ("source_submission_id") REFERENCES "public"."match_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_events_created_idx" ON "admin_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_events_entity_idx" ON "admin_audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_submissions_active_fingerprint_uidx" ON "match_submissions" USING btree ("fingerprint") WHERE "match_submissions"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "match_submissions_status_submitted_idx" ON "match_submissions" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "match_submissions_game_idx" ON "match_submissions" USING btree ("game");--> statement-breakpoint
CREATE INDEX "published_manual_matches_visible_time_idx" ON "published_manual_matches" USING btree ("hidden","start_time_utc");--> statement-breakpoint
CREATE INDEX "published_manual_matches_game_idx" ON "published_manual_matches" USING btree ("game");