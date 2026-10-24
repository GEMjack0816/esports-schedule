CREATE TABLE "submission_rate_limit_windows" (
	"window_key" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_rate_limit_windows_request_count_check" CHECK ("submission_rate_limit_windows"."request_count" >= 0)
);
