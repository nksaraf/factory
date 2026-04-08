ALTER TABLE "org"."webhook_event" ADD COLUMN "actor_id" text;--> statement-breakpoint
ALTER TABLE "org"."webhook_event" ADD COLUMN "event_type" text;--> statement-breakpoint
ALTER TABLE "org"."webhook_event" ADD COLUMN "entity_id" text;--> statement-breakpoint
CREATE INDEX "org_webhook_event_actor_idx" ON "org"."webhook_event" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "org_webhook_event_event_type_idx" ON "org"."webhook_event" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "org_webhook_event_entity_idx" ON "org"."webhook_event" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "org_webhook_event_actor_created_idx" ON "org"."webhook_event" USING btree ("actor_id", "created_at");--> statement-breakpoint
CREATE INDEX "org_webhook_event_event_type_created_idx" ON "org"."webhook_event" USING btree ("event_type", "created_at");
