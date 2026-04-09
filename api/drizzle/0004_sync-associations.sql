CREATE TABLE "build"."work_tracker_project" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "work_tracker_provider_id" text NOT NULL,
  "external_id" text NOT NULL,
  "spec" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "build"."work_tracker_project"
  ADD CONSTRAINT "build_work_tracker_project_work_tracker_provider_id_fkey"
  FOREIGN KEY ("work_tracker_provider_id")
  REFERENCES "build"."work_tracker_provider"("id")
  ON DELETE cascade
  ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "build_work_tracker_project_slug_unique" ON "build"."work_tracker_project" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "build_work_tracker_project_provider_external_unique" ON "build"."work_tracker_project" USING btree ("work_tracker_provider_id", "external_id");--> statement-breakpoint
CREATE INDEX "build_work_tracker_project_provider_idx" ON "build"."work_tracker_project" USING btree ("work_tracker_provider_id");--> statement-breakpoint

ALTER TABLE "software"."entity_relationship" SET SCHEMA "org";--> statement-breakpoint
ALTER TABLE "org"."entity_relationship" DROP CONSTRAINT IF EXISTS "software_entity_rel_type_valid";--> statement-breakpoint
ALTER TABLE "org"."entity_relationship"
  ADD CONSTRAINT "org_entity_rel_type_valid"
  CHECK ("type" IN ('consumes-api', 'depends-on', 'provides', 'owned-by', 'deployed-alongside', 'triggers', 'tracks', 'maps-to'));--> statement-breakpoint
ALTER INDEX IF EXISTS "org"."software_entity_rel_unique" RENAME TO "org_entity_rel_unique";--> statement-breakpoint
ALTER INDEX IF EXISTS "org"."software_entity_rel_type_idx" RENAME TO "org_entity_rel_type_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "org"."software_entity_rel_source_idx" RENAME TO "org_entity_rel_source_idx";--> statement-breakpoint
ALTER INDEX IF EXISTS "org"."software_entity_rel_target_idx" RENAME TO "org_entity_rel_target_idx";
