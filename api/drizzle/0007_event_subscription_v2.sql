-- Replace legacy event_subscription (workflow_run_id / event_name) with the current
-- org.event_subscription model used by Drizzle (topic triggers, streams, etc.).

DROP INDEX IF EXISTS "org"."org_esub_event_name_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "org"."org_esub_workflow_run_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "org"."org_esub_match_fields_gin_idx";
--> statement-breakpoint
DROP TABLE IF EXISTS "org"."event_subscription";
--> statement-breakpoint
CREATE TABLE "org"."event_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"topic_filter" text NOT NULL,
	"match_fields" jsonb,
	"min_severity" text,
	"scope_kind" text,
	"scope_id" text,
	"owner_kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "org_esub_topic_filter_idx" ON "org"."event_subscription" USING btree ("topic_filter");
--> statement-breakpoint
CREATE INDEX "org_esub_kind_idx" ON "org"."event_subscription" USING btree ("kind");
--> statement-breakpoint
CREATE INDEX "org_esub_status_idx" ON "org"."event_subscription" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "org_esub_owner_idx" ON "org"."event_subscription" USING btree ("owner_kind", "owner_id");
--> statement-breakpoint
CREATE INDEX "org_esub_match_fields_gin_idx" ON "org"."event_subscription" USING gin (COALESCE("match_fields", '{}'::jsonb));
