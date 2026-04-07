CREATE TABLE "org"."event_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"event_name" text NOT NULL,
	"match_fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org"."workflow_run" (
	"workflow_run_id" text PRIMARY KEY NOT NULL,
	"workflow_name" text NOT NULL,
	"trigger" text NOT NULL,
	"trigger_payload" jsonb,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"state" jsonb DEFAULT '{}' NOT NULL,
	"phase" text DEFAULT 'started' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"parent_workflow_run_id" text,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "org_esub_event_name_idx" ON "org"."event_subscription" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "org_esub_workflow_run_idx" ON "org"."event_subscription" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "org_esub_match_fields_gin_idx" ON "org"."event_subscription" USING gin ("match_fields");--> statement-breakpoint
CREATE INDEX "org_wf_run_workflow_name_idx" ON "org"."workflow_run" USING btree ("workflow_name");--> statement-breakpoint
CREATE INDEX "org_wf_run_status_idx" ON "org"."workflow_run" USING btree ("status");--> statement-breakpoint
CREATE INDEX "org_wf_run_parent_idx" ON "org"."workflow_run" USING btree ("parent_workflow_run_id");