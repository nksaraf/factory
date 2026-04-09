CREATE TABLE IF NOT EXISTS "org"."webhook_event" (
  "id" text PRIMARY KEY NOT NULL,
  "source" text NOT NULL,
  "provider_id" text NOT NULL,
  "delivery_id" text NOT NULL,
  "spec" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_webhook_event_source_provider_delivery_unique" ON "org"."webhook_event" USING btree ("source", "provider_id", "delivery_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_webhook_event_source_idx" ON "org"."webhook_event" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_webhook_event_provider_idx" ON "org"."webhook_event" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_webhook_event_created_idx" ON "org"."webhook_event" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "org"."webhook_event" ADD COLUMN IF NOT EXISTS "actor_id" text;--> statement-breakpoint
ALTER TABLE "org"."webhook_event" ADD COLUMN IF NOT EXISTS "event_type" text;--> statement-breakpoint
ALTER TABLE "org"."webhook_event" ADD COLUMN IF NOT EXISTS "entity_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_webhook_event_actor_idx" ON "org"."webhook_event" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_webhook_event_event_type_idx" ON "org"."webhook_event" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_webhook_event_entity_idx" ON "org"."webhook_event" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_webhook_event_actor_created_idx" ON "org"."webhook_event" USING btree ("actor_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_webhook_event_event_type_created_idx" ON "org"."webhook_event" USING btree ("event_type", "created_at");
