CREATE TABLE "org"."event" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"source" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"correlation_id" text,
	"parent_event_id" text,
	"principal_id" text,
	"entity_kind" text,
	"entity_id" text,
	"scope_kind" text DEFAULT 'org' NOT NULL,
	"scope_id" text DEFAULT 'default' NOT NULL,
	"raw_event_type" text,
	"idempotency_key" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."event_outbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "org"."event_outbox" ADD CONSTRAINT "event_outbox_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "org"."event"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "org_event_topic_idx" ON "org"."event" USING btree ("topic");
--> statement-breakpoint
CREATE INDEX "org_event_source_idx" ON "org"."event" USING btree ("source");
--> statement-breakpoint
CREATE INDEX "org_event_entity_idx" ON "org"."event" USING btree ("entity_kind","entity_id");
--> statement-breakpoint
CREATE INDEX "org_event_principal_idx" ON "org"."event" USING btree ("principal_id");
--> statement-breakpoint
CREATE INDEX "org_event_occurred_idx" ON "org"."event" USING btree ("occurred_at");
--> statement-breakpoint
CREATE INDEX "org_event_correlation_idx" ON "org"."event" USING btree ("correlation_id");
--> statement-breakpoint
CREATE INDEX "org_event_parent_idx" ON "org"."event" USING btree ("parent_event_id");
--> statement-breakpoint
CREATE INDEX "org_event_severity_idx" ON "org"."event" USING btree ("severity");
--> statement-breakpoint
CREATE UNIQUE INDEX "org_event_idempotency_unique" ON "org"."event" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "org_event_spec_gin_idx" ON "org"."event" USING gin ("spec");
--> statement-breakpoint
CREATE INDEX "org_event_outbox_pending_idx" ON "org"."event_outbox" USING btree ("created_at");
--> statement-breakpoint
ALTER TABLE "org"."event_outbox" ADD CONSTRAINT "org_event_outbox_status_valid" CHECK ("org"."event_outbox"."status" IN ('pending', 'published', 'failed'));
