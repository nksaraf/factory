CREATE TABLE "factory_build"."pipeline_run" (
	"pipeline_run_id" text PRIMARY KEY NOT NULL,
	"repo_id" text,
	"trigger_event" text NOT NULL,
	"trigger_ref" text NOT NULL,
	"commit_sha" text NOT NULL,
	"workflow_file" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"sandbox_id" text,
	"webhook_event_id" text,
	"trigger_actor" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_run_trigger_event_valid" CHECK ("factory_build"."pipeline_run"."trigger_event" IN ('push', 'pull_request', 'manual', 'schedule')),
	CONSTRAINT "pipeline_run_status_valid" CHECK ("factory_build"."pipeline_run"."status" IN ('pending', 'queued', 'running', 'success', 'failure', 'cancelled', 'timed_out'))
);
--> statement-breakpoint
CREATE TABLE "factory_build"."pipeline_step_run" (
	"pipeline_step_run_id" text PRIMARY KEY NOT NULL,
	"pipeline_run_id" text NOT NULL,
	"job_name" text NOT NULL,
	"step_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"exit_code" bigint,
	"log_url" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_step_run_status_valid" CHECK ("factory_build"."pipeline_step_run"."status" IN ('pending', 'running', 'success', 'failure', 'skipped', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "factory_build"."pipeline_run" ADD CONSTRAINT "pipeline_run_repo_id_repo_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "factory_build"."repo"("repo_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."pipeline_run" ADD CONSTRAINT "pipeline_run_webhook_event_id_webhook_event_webhook_event_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "factory_build"."webhook_event"("webhook_event_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."pipeline_step_run" ADD CONSTRAINT "pipeline_step_run_pipeline_run_id_pipeline_run_pipeline_run_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "factory_build"."pipeline_run"("pipeline_run_id") ON DELETE cascade ON UPDATE no action;