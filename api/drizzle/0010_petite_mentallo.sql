-- Step 1: Add new columns (slug nullable initially for data migration)
ALTER TABLE "ops"."preview" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD COLUMN "strategy" text DEFAULT 'deploy' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD COLUMN "workbench_id" text;--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD COLUMN "system_deployment_id" text;--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD COLUMN "realm_id" text;--> statement-breakpoint

-- Step 2: Promote JSONB values to columns
UPDATE "ops"."preview" SET
  slug = spec->>'slug',
  workbench_id = spec->>'workbenchId',
  system_deployment_id = spec->>'systemDeploymentId',
  realm_id = spec->>'realmId'
WHERE spec IS NOT NULL;--> statement-breakpoint

-- Step 3: Backfill any rows with NULL slug using id
UPDATE "ops"."preview" SET slug = id WHERE slug IS NULL;--> statement-breakpoint

-- Step 4: Set slug NOT NULL now that all rows have values
ALTER TABLE "ops"."preview" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- Step 5: Clean migrated keys from JSONB spec
UPDATE "ops"."preview" SET spec = spec - 'slug' - 'workbenchId' - 'systemDeploymentId' - 'realmId';--> statement-breakpoint

-- Step 6: Add FK constraints (after data migration so references are valid)
ALTER TABLE "ops"."preview" ADD CONSTRAINT "preview_workbench_id_workbench_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "ops"."workbench"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD CONSTRAINT "preview_system_deployment_id_system_deployment_id_fk" FOREIGN KEY ("system_deployment_id") REFERENCES "ops"."system_deployment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD CONSTRAINT "preview_realm_id_realm_id_fk" FOREIGN KEY ("realm_id") REFERENCES "infra"."realm"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Step 7: Add indexes
CREATE INDEX "ops_preview_slug_idx" ON "ops"."preview" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ops_preview_strategy_idx" ON "ops"."preview" USING btree ("strategy");--> statement-breakpoint
CREATE INDEX "ops_preview_workbench_idx" ON "ops"."preview" USING btree ("workbench_id");--> statement-breakpoint
CREATE INDEX "ops_preview_sd_idx" ON "ops"."preview" USING btree ("system_deployment_id");
