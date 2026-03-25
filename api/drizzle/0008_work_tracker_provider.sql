-- Work tracker provider table
CREATE TABLE IF NOT EXISTS "factory_product"."work_tracker_provider" (
  "work_tracker_provider_id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "kind" text NOT NULL,
  "api_url" text NOT NULL,
  "credentials_ref" text,
  "default_project_key" text,
  "status" text NOT NULL DEFAULT 'active',
  "sync_enabled" boolean NOT NULL DEFAULT true,
  "sync_interval_minutes" integer NOT NULL DEFAULT 5,
  "sync_status" text NOT NULL DEFAULT 'idle',
  "last_sync_at" timestamp with time zone,
  "sync_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "work_tracker_kind_valid" CHECK ("kind" IN ('jira', 'linear')),
  CONSTRAINT "work_tracker_status_valid" CHECK ("status" IN ('active', 'inactive')),
  CONSTRAINT "work_tracker_sync_status_valid" CHECK ("sync_status" IN ('idle', 'syncing', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "work_tracker_provider_slug_unique"
  ON "factory_product"."work_tracker_provider" ("slug");

-- Work tracker project mapping table
CREATE TABLE IF NOT EXISTS "factory_product"."work_tracker_project_mapping" (
  "mapping_id" text PRIMARY KEY NOT NULL,
  "work_tracker_provider_id" text NOT NULL
    REFERENCES "factory_product"."work_tracker_provider"("work_tracker_provider_id") ON DELETE CASCADE,
  "module_id" text NOT NULL
    REFERENCES "factory_product"."module"("module_id") ON DELETE CASCADE,
  "external_project_id" text NOT NULL,
  "external_project_name" text,
  "sync_direction" text NOT NULL DEFAULT 'pull',
  "filter_query" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "sync_direction_valid" CHECK ("sync_direction" IN ('pull', 'push', 'bidirectional'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "work_tracker_mapping_unique"
  ON "factory_product"."work_tracker_project_mapping"
  ("work_tracker_provider_id", "module_id", "external_project_id");

-- Extend work_item with new columns
ALTER TABLE "factory_product"."work_item"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'story',
  ADD COLUMN IF NOT EXISTS "priority" text,
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "labels" jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "parent_work_item_id" text,
  ADD COLUMN IF NOT EXISTS "external_key" text,
  ADD COLUMN IF NOT EXISTS "work_tracker_provider_id" text;

DO $$ BEGIN
  ALTER TABLE "factory_product"."work_item"
    ADD CONSTRAINT "work_item_kind_valid" CHECK ("kind" IN ('epic', 'story', 'task', 'bug'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
