CREATE TABLE "ops"."operation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"summary" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opr_trigger_valid" CHECK ("ops"."operation_run"."trigger" IN ('schedule', 'manual', 'startup')),
	CONSTRAINT "opr_status_valid" CHECK ("ops"."operation_run"."status" IN ('running', 'succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX "ops_opr_name_started_idx" ON "ops"."operation_run" USING btree ("name","started_at");--> statement-breakpoint
CREATE INDEX "ops_opr_status_idx" ON "ops"."operation_run" USING btree ("name","status");