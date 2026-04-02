ALTER TABLE "factory_fleet"."sandbox" ADD COLUMN "health_status" text DEFAULT 'unknown';
ALTER TABLE "factory_fleet"."sandbox" ADD COLUMN "health_checked_at" timestamp with time zone;
