ALTER TABLE "ops"."preview" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ops"."preview" CASCADE;--> statement-breakpoint
ALTER TABLE "ops"."site" ADD COLUMN "parent_site_id" text;--> statement-breakpoint
ALTER TABLE "ops"."site" ADD COLUMN "status" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."site" ADD COLUMN "generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."site" ADD COLUMN "observed_generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "ops_site_parent_idx" ON "ops"."site" USING btree ("parent_site_id");