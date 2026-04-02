-- Add preview config to sites for opt-in preview deployments
ALTER TABLE "factory_fleet"."site" ADD COLUMN "preview_config" jsonb NOT NULL DEFAULT '{"enabled":false}';

-- Add GitHub integration columns to preview table
ALTER TABLE "factory_fleet"."preview" ADD COLUMN "github_deployment_id" integer;
ALTER TABLE "factory_fleet"."preview" ADD COLUMN "github_comment_id" integer;

-- Update preview status constraint to include pending_image
ALTER TABLE "factory_fleet"."preview" DROP CONSTRAINT IF EXISTS "preview_status_valid";
ALTER TABLE "factory_fleet"."preview" ADD CONSTRAINT "preview_status_valid"
  CHECK (status IN ('pending_image', 'building', 'deploying', 'active', 'inactive', 'expired', 'failed'));
