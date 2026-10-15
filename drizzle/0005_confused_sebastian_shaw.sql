CREATE SEQUENCE "public"."manual_match_cache_revision_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "manual_match_cache_outbox" (
	"revision" bigint PRIMARY KEY DEFAULT nextval('manual_match_cache_revision_seq') NOT NULL,
	"event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	CONSTRAINT "manual_match_cache_outbox_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "manual_match_cache_outbox_attempt_count_check" CHECK ("manual_match_cache_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "manual_match_cache_outbox_pending_idx" ON "manual_match_cache_outbox" USING btree ("revision") WHERE "manual_match_cache_outbox"."delivered_at" is null;
