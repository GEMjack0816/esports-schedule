CREATE TABLE "submission_rate_limits" (
	"source_hash" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_rate_limits_request_count_check" CHECK ("submission_rate_limits"."request_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "submission_rate_limits_updated_idx" ON "submission_rate_limits" USING btree ("updated_at");