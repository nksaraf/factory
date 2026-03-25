CREATE SCHEMA "factory_agent";
--> statement-breakpoint
CREATE SCHEMA "factory_build";
--> statement-breakpoint
CREATE SCHEMA "factory_commerce";
--> statement-breakpoint
CREATE SCHEMA "factory_fleet";
--> statement-breakpoint
CREATE SCHEMA "factory_infra";
--> statement-breakpoint
CREATE SCHEMA "factory_product";
--> statement-breakpoint
CREATE TABLE "factory_agent"."agent" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"agent_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_type_valid" CHECK ("factory_agent"."agent"."agent_type" IN ('engineering', 'qa', 'product', 'security', 'ops', 'external-mcp')),
	CONSTRAINT "agent_status_valid" CHECK ("factory_agent"."agent"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "factory_agent"."agent_execution" (
	"execution_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"task" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cost_cents" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "agent_execution_status_valid" CHECK ("factory_agent"."agent_execution"."status" IN ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "factory_build"."artifact" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"image_ref" text NOT NULL,
	"image_digest" text NOT NULL,
	"size_bytes" bigint,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_build"."component_artifact" (
	"component_artifact_id" text PRIMARY KEY NOT NULL,
	"module_version_id" text NOT NULL,
	"component_id" text NOT NULL,
	"artifact_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_build"."module_version" (
	"module_version_id" text PRIMARY KEY NOT NULL,
	"module_id" text NOT NULL,
	"version" text NOT NULL,
	"compatibility_range" text,
	"schema_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_build"."repo" (
	"repo_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"module_id" text,
	"team_id" text NOT NULL,
	"git_url" text NOT NULL,
	"default_branch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_kind_valid" CHECK ("factory_build"."repo"."kind" IN ('product-module', 'platform-module', 'library', 'vendor-module', 'client-project', 'infra', 'docs', 'tool'))
);
--> statement-breakpoint
CREATE TABLE "factory_commerce"."plan" (
	"plan_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"included_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_commerce"."customer_account" (
	"customer_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_status_valid" CHECK ("factory_commerce"."customer_account"."status" IN ('trial', 'active', 'suspended', 'terminated'))
);
--> statement-breakpoint
CREATE TABLE "factory_commerce"."entitlement" (
	"entitlement_id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"module_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"quotas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_status_valid" CHECK ("factory_commerce"."entitlement"."status" IN ('active', 'suspended', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."connection_audit_event" (
	"event_id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"deployment_target_id" text NOT NULL,
	"connected_resources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"readonly" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."dependency_workload" (
	"dependency_workload_id" text PRIMARY KEY NOT NULL,
	"deployment_target_id" text NOT NULL,
	"name" text NOT NULL,
	"image" text NOT NULL,
	"port" integer NOT NULL,
	"env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	CONSTRAINT "dependency_workload_status_valid" CHECK ("factory_fleet"."dependency_workload"."status" IN ('provisioning', 'running', 'failed', 'stopped'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."deployment_target" (
	"deployment_target_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"site_id" text,
	"cluster_id" text,
	"namespace" text,
	"created_by" text NOT NULL,
	"trigger" text NOT NULL,
	"ttl" text,
	"expires_at" timestamp with time zone,
	"tier_policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"destroyed_at" timestamp with time zone,
	CONSTRAINT "deployment_target_kind_valid" CHECK ("factory_fleet"."deployment_target"."kind" IN ('production', 'staging', 'sandbox', 'dev')),
	CONSTRAINT "deployment_target_trigger_valid" CHECK ("factory_fleet"."deployment_target"."trigger" IN ('manual', 'pr', 'release', 'agent', 'ci')),
	CONSTRAINT "deployment_target_status_valid" CHECK ("factory_fleet"."deployment_target"."status" IN ('provisioning', 'active', 'suspended', 'destroying', 'destroyed'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."site" (
	"site_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"product" text NOT NULL,
	"cluster_id" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_site_status_valid" CHECK ("factory_fleet"."site"."status" IN ('provisioning', 'active', 'suspended', 'decommissioned'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."intervention" (
	"intervention_id" text PRIMARY KEY NOT NULL,
	"deployment_target_id" text NOT NULL,
	"workload_id" text,
	"action" text NOT NULL,
	"principal_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."release" (
	"release_id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_status_valid" CHECK ("factory_fleet"."release"."status" IN ('draft', 'staging', 'production', 'superseded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."release_module_pin" (
	"release_module_pin_id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"module_version_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."rollout" (
	"rollout_id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"deployment_target_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "rollout_status_valid" CHECK ("factory_fleet"."rollout"."status" IN ('pending', 'in_progress', 'succeeded', 'failed', 'rolled_back'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."workload" (
	"workload_id" text PRIMARY KEY NOT NULL,
	"deployment_target_id" text NOT NULL,
	"module_version_id" text NOT NULL,
	"component_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"replicas" integer DEFAULT 1 NOT NULL,
	"env_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resource_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"desired_image" text NOT NULL,
	"actual_image" text,
	"drift_detected" boolean DEFAULT false NOT NULL,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workload_status_valid" CHECK ("factory_fleet"."workload"."status" IN ('provisioning', 'running', 'degraded', 'stopped', 'failed', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."workload_override" (
	"override_id" text PRIMARY KEY NOT NULL,
	"workload_id" text NOT NULL,
	"field" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by" text
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."cluster" (
	"cluster_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider_id" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"kubeconfig_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_status_valid" CHECK ("factory_infra"."cluster"."status" IN ('provisioning', 'ready', 'degraded', 'destroying'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."provider" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider_type" text NOT NULL,
	"url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"credentials_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_type_valid" CHECK ("factory_infra"."provider"."provider_type" IN ('proxmox', 'hetzner', 'aws', 'gcp')),
	CONSTRAINT "provider_status_valid" CHECK ("factory_infra"."provider"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."vm" (
	"vm_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider_id" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"cpu" integer NOT NULL,
	"memory_mb" integer NOT NULL,
	"disk_gb" integer NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vm_status_valid" CHECK ("factory_infra"."vm"."status" IN ('provisioning', 'running', 'stopped', 'destroying'))
);
--> statement-breakpoint
CREATE TABLE "factory_product"."component_spec" (
	"component_id" text PRIMARY KEY NOT NULL,
	"module_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"port" integer,
	"healthcheck_path" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"run_order" integer,
	"default_replicas" integer DEFAULT 1 NOT NULL,
	"default_cpu" text DEFAULT '100m' NOT NULL,
	"default_memory" text DEFAULT '128Mi' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "component_spec_kind_valid" CHECK ("factory_product"."component_spec"."kind" IN ('deployment', 'statefulset', 'job', 'cronjob'))
);
--> statement-breakpoint
CREATE TABLE "factory_product"."module" (
	"module_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"team" text NOT NULL,
	"product" text,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_lifecycle_valid" CHECK ("factory_product"."module"."lifecycle_state" IN ('active', 'deprecated', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "factory_product"."work_item" (
	"work_item_id" text PRIMARY KEY NOT NULL,
	"module_id" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'backlog' NOT NULL,
	"assignee" text,
	"external_id" text,
	"external_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_status_valid" CHECK ("factory_product"."work_item"."status" IN ('backlog', 'ready', 'in_progress', 'in_review', 'done'))
);
--> statement-breakpoint
ALTER TABLE "factory_agent"."agent_execution" ADD CONSTRAINT "agent_execution_agent_id_agent_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "factory_agent"."agent"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."component_artifact" ADD CONSTRAINT "component_artifact_module_version_id_module_version_module_version_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "factory_build"."module_version"("module_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."component_artifact" ADD CONSTRAINT "component_artifact_component_id_component_spec_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "factory_product"."component_spec"("component_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."component_artifact" ADD CONSTRAINT "component_artifact_artifact_id_artifact_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "factory_build"."artifact"("artifact_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."module_version" ADD CONSTRAINT "module_version_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."repo" ADD CONSTRAINT "repo_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_commerce"."entitlement" ADD CONSTRAINT "entitlement_customer_id_customer_account_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "factory_commerce"."customer_account"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_commerce"."entitlement" ADD CONSTRAINT "entitlement_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."connection_audit_event" ADD CONSTRAINT "connection_audit_event_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."dependency_workload" ADD CONSTRAINT "dependency_workload_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."deployment_target" ADD CONSTRAINT "deployment_target_site_id_site_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."deployment_target" ADD CONSTRAINT "deployment_target_cluster_id_cluster_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "factory_infra"."cluster"("cluster_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."site" ADD CONSTRAINT "site_cluster_id_cluster_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "factory_infra"."cluster"("cluster_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."intervention" ADD CONSTRAINT "intervention_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."intervention" ADD CONSTRAINT "intervention_workload_id_workload_workload_id_fk" FOREIGN KEY ("workload_id") REFERENCES "factory_fleet"."workload"("workload_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."release_module_pin" ADD CONSTRAINT "release_module_pin_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "factory_fleet"."release"("release_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."release_module_pin" ADD CONSTRAINT "release_module_pin_module_version_id_module_version_module_version_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "factory_build"."module_version"("module_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."rollout" ADD CONSTRAINT "rollout_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "factory_fleet"."release"("release_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."rollout" ADD CONSTRAINT "rollout_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."workload" ADD CONSTRAINT "workload_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."workload" ADD CONSTRAINT "workload_module_version_id_module_version_module_version_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "factory_build"."module_version"("module_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."workload" ADD CONSTRAINT "workload_component_id_component_spec_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "factory_product"."component_spec"("component_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."workload" ADD CONSTRAINT "workload_artifact_id_artifact_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "factory_build"."artifact"("artifact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."workload_override" ADD CONSTRAINT "workload_override_workload_id_workload_workload_id_fk" FOREIGN KEY ("workload_id") REFERENCES "factory_fleet"."workload"("workload_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."cluster" ADD CONSTRAINT "cluster_provider_id_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "factory_infra"."provider"("provider_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD CONSTRAINT "vm_provider_id_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "factory_infra"."provider"("provider_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_product"."component_spec" ADD CONSTRAINT "component_spec_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_product"."work_item" ADD CONSTRAINT "work_item_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_name_unique" ON "factory_agent"."agent" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "module_version_module_version_unique" ON "factory_build"."module_version" USING btree ("module_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_name_unique" ON "factory_build"."repo" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_target_name_unique" ON "factory_fleet"."deployment_target" USING btree ("name");--> statement-breakpoint
CREATE INDEX "deployment_target_kind_status_idx" ON "factory_fleet"."deployment_target" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_site_name_unique" ON "factory_fleet"."site" USING btree ("name");--> statement-breakpoint
CREATE INDEX "fleet_site_product_idx" ON "factory_fleet"."site" USING btree ("product");--> statement-breakpoint
CREATE UNIQUE INDEX "release_version_unique" ON "factory_fleet"."release" USING btree ("version");--> statement-breakpoint
CREATE INDEX "rollout_release_idx" ON "factory_fleet"."rollout" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "workload_target_component_idx" ON "factory_fleet"."workload" USING btree ("deployment_target_id","component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_name_unique" ON "factory_infra"."cluster" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "component_spec_module_name_unique" ON "factory_product"."component_spec" USING btree ("module_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "module_name_unique" ON "factory_product"."module" USING btree ("name");--> statement-breakpoint
CREATE INDEX "work_item_status_idx" ON "factory_product"."work_item" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_item_assignee_idx" ON "factory_product"."work_item" USING btree ("assignee");
