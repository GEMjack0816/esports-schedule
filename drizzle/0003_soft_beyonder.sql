CREATE TABLE "pandascore_game_snapshots" (
	"game" text PRIMARY KEY NOT NULL,
	"snapshot_payload" jsonb NOT NULL,
	"source_fetched_at" timestamp with time zone NOT NULL,
	"last_successful_sync_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,
	"last_http_status" integer,
	"generation" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pandascore_game_snapshots_game_check" CHECK (game in ('lol', 'valorant', 'honor-of-kings', 'cs2', 'dota2'))
);
