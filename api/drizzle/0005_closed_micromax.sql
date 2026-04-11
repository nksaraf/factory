CREATE TABLE "org"."event" (
	"id" text PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"source" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"correlation_id" text,
	"parent_event_id" text,
	"principal_id" text,
	"entity_kind" text,
	"entity_id" text,
	"scope_kind" text DEFAULT 'org' NOT NULL,
	"scope_id" text DEFAULT 'default' NOT NULL,
	"raw_event_type" text,
	"idempotency_key" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."event_outbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "org_event_outbox_status_valid" CHECK ("org"."event_outbox"."status" IN ('pending', 'published', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "ops"."forwarded_port" DROP CONSTRAINT IF EXISTS "forwarded_port_workspace_id_workspace_id_fk";--> statement-breakpoint
ALTER TABLE "ops"."workspace_snapshot" DROP CONSTRAINT IF EXISTS "workspace_snapshot_workspace_id_workspace_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "ops"."ops_workspace_snapshot_workspace_idx";--> statement-breakpoint
ALTER TABLE "ops"."workspace_snapshot" RENAME TO "workbench_snapshot";--> statement-breakpoint
ALTER TABLE "ops"."workbench_snapshot" RENAME COLUMN "workspace_id" TO "workbench_id";--> statement-breakpoint
DROP INDEX IF EXISTS "ops"."ops_forwarded_port_workspace_idx";--> statement-breakpoint
ALTER TABLE "ops"."forwarded_port" RENAME COLUMN "workspace_id" TO "workbench_id";--> statement-breakpoint
ALTER TABLE "software"."template" DROP CONSTRAINT "software_template_type_valid";--> statement-breakpoint
DROP INDEX IF EXISTS "ops"."ops_workbench_slug_unique";--> statement-breakpoint
ALTER TABLE "ops"."workspace" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ops"."workspace" CASCADE;--> statement-breakpoint
ALTER TABLE "ops"."component_deployment" ADD COLUMN "workbench_id" text;--> statement-breakpoint
ALTER TABLE "ops"."component_deployment" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "ops"."system_deployment" ADD COLUMN "workbench_id" text;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "host_id" text;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "realm_id" text;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "parent_workbench_id" text;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "metadata" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "valid_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "valid_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "system_from" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "system_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "changed_by" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "change_reason" text;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "status" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD COLUMN "observed_generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "org"."event_outbox" ADD CONSTRAINT "event_outbox_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "org"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_event_topic_idx" ON "org"."event" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "org_event_source_idx" ON "org"."event" USING btree ("source");--> statement-breakpoint
CREATE INDEX "org_event_entity_idx" ON "org"."event" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "org_event_principal_idx" ON "org"."event" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "org_event_occurred_idx" ON "org"."event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "org_event_correlation_idx" ON "org"."event" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "org_event_parent_idx" ON "org"."event" USING btree ("parent_event_id");--> statement-breakpoint
CREATE INDEX "org_event_severity_idx" ON "org"."event" USING btree ("severity");--> statement-breakpoint
CREATE UNIQUE INDEX "org_event_idempotency_unique" ON "org"."event" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "org_event_spec_gin_idx" ON "org"."event" USING gin ("spec");--> statement-breakpoint
CREATE INDEX "org_event_outbox_pending_idx" ON "org"."event_outbox" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "ops"."component_deployment" ADD CONSTRAINT "component_deployment_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "infra"."service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."forwarded_port" ADD CONSTRAINT "forwarded_port_workbench_id_workbench_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "ops"."workbench"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD CONSTRAINT "workbench_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "ops"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD CONSTRAINT "workbench_host_id_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "infra"."host"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD CONSTRAINT "workbench_realm_id_realm_id_fk" FOREIGN KEY ("realm_id") REFERENCES "infra"."realm"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD CONSTRAINT "workbench_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "infra"."service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD CONSTRAINT "workbench_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "software"."template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workbench" ADD CONSTRAINT "workbench_owner_id_principal_id_fk" FOREIGN KEY ("owner_id") REFERENCES "org"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workbench_snapshot" ADD CONSTRAINT "workbench_snapshot_workbench_id_workbench_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "ops"."workbench"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ops_component_deployment_workbench_idx" ON "ops"."component_deployment" USING btree ("workbench_id");--> statement-breakpoint
CREATE INDEX "ops_component_deployment_service_idx" ON "ops"."component_deployment" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "ops_forwarded_port_workbench_idx" ON "ops"."forwarded_port" USING btree ("workbench_id");--> statement-breakpoint
CREATE INDEX "ops_system_deployment_workbench_idx" ON "ops"."system_deployment" USING btree ("workbench_id");--> statement-breakpoint
CREATE INDEX "ops_workbench_slug_idx" ON "ops"."workbench" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ops_workbench_site_idx" ON "ops"."workbench" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "ops_workbench_host_idx" ON "ops"."workbench" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "ops_workbench_realm_idx" ON "ops"."workbench" USING btree ("realm_id");--> statement-breakpoint
CREATE INDEX "ops_workbench_service_idx" ON "ops"."workbench" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "ops_workbench_parent_idx" ON "ops"."workbench" USING btree ("parent_workbench_id");--> statement-breakpoint
CREATE INDEX "ops_workbench_owner_idx" ON "ops"."workbench" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "ops_workbench_snapshot_workbench_idx" ON "ops"."workbench_snapshot" USING btree ("workbench_id");--> statement-breakpoint
ALTER TABLE "software"."template" ADD CONSTRAINT "software_template_type_valid" CHECK ("software"."template"."type" IN ('component', 'system', 'workbench'));
