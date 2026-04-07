-- Promote JSONB spec fields to proper DB columns for uniqueness, filtering, and joins.
-- All new columns added with defaults so existing rows remain valid.

-- ── org.identity_link ──────────────────────────────────────
ALTER TABLE "org"."identity_link" ADD COLUMN "external_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX "org_identity_link_type_external_unique" ON "org"."identity_link" USING btree ("type","external_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "org_identity_link_principal_type_unique" ON "org"."identity_link" USING btree ("principal_id","type");

--> statement-breakpoint
-- ── org.ssh_key ────────────────────────────────────────────
ALTER TABLE "org"."ssh_key" ADD COLUMN "fingerprint" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX "org_ssh_key_fingerprint_unique" ON "org"."ssh_key" USING btree ("fingerprint");

--> statement-breakpoint
-- ── org.job ────────────────────────────────────────────────
ALTER TABLE "org"."job" ADD COLUMN "status" text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "org"."job" ADD COLUMN "mode" text NOT NULL DEFAULT 'conversational';
--> statement-breakpoint
ALTER TABLE "org"."job" ADD COLUMN "trigger" text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
CREATE INDEX "org_job_status_idx" ON "org"."job" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "org_job_mode_idx" ON "org"."job" USING btree ("mode");
--> statement-breakpoint
ALTER TABLE "org"."job" ADD CONSTRAINT "org_job_status_valid" CHECK ("status" IN ('pending', 'running', 'completed', 'failed', 'cancelled'));
--> statement-breakpoint
ALTER TABLE "org"."job" ADD CONSTRAINT "org_job_mode_valid" CHECK ("mode" IN ('conversational', 'autonomous', 'observation'));
--> statement-breakpoint
ALTER TABLE "org"."job" ADD CONSTRAINT "org_job_trigger_valid" CHECK ("trigger" IN ('mention', 'event', 'schedule', 'delegation', 'manual'));

--> statement-breakpoint
-- ── org.memory ─────────────────────────────────────────────
ALTER TABLE "org"."memory" ADD COLUMN "layer" text NOT NULL DEFAULT 'session';
--> statement-breakpoint
ALTER TABLE "org"."memory" ADD COLUMN "status" text NOT NULL DEFAULT 'proposed';
--> statement-breakpoint
ALTER TABLE "org"."memory" ADD COLUMN "source_agent_id" text REFERENCES "org"."agent"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "org_memory_layer_idx" ON "org"."memory" USING btree ("layer");
--> statement-breakpoint
CREATE INDEX "org_memory_status_idx" ON "org"."memory" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "org_memory_source_agent_idx" ON "org"."memory" USING btree ("source_agent_id");
--> statement-breakpoint
ALTER TABLE "org"."memory" ADD CONSTRAINT "org_memory_layer_valid" CHECK ("layer" IN ('session', 'team', 'org'));
--> statement-breakpoint
ALTER TABLE "org"."memory" ADD CONSTRAINT "org_memory_status_valid" CHECK ("status" IN ('proposed', 'approved', 'superseded', 'archived'));

--> statement-breakpoint
-- ── org.agent ──────────────────────────────────────────────
ALTER TABLE "org"."agent" ADD COLUMN "status" text NOT NULL DEFAULT 'active';
--> statement-breakpoint
CREATE INDEX "org_agent_status_idx" ON "org"."agent" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "org"."agent" ADD CONSTRAINT "org_agent_status_valid" CHECK ("status" IN ('active', 'disabled'));

--> statement-breakpoint
-- ── org.tool_usage ─────────────────────────────────────────
ALTER TABLE "org"."tool_usage" ADD COLUMN "tool" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "org"."tool_usage" ADD COLUMN "cost_microdollars" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX "org_tool_usage_tool_created_idx" ON "org"."tool_usage" USING btree ("tool","created_at");
--> statement-breakpoint
CREATE INDEX "org_tool_usage_principal_created_idx" ON "org"."tool_usage" USING btree ("principal_id","created_at");

--> statement-breakpoint
-- ── build.webhook_event ────────────────────────────────────
ALTER TABLE "build"."webhook_event" ADD COLUMN "git_host_provider_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "build"."webhook_event" ADD COLUMN "delivery_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "build"."webhook_event" ADD CONSTRAINT "build_webhook_event_git_host_provider_id_build_git_host_provider_id_fk" FOREIGN KEY ("git_host_provider_id") REFERENCES "build"."git_host_provider"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "build_webhook_event_provider_delivery_unique" ON "build"."webhook_event" USING btree ("git_host_provider_id","delivery_id");
--> statement-breakpoint
CREATE INDEX "build_webhook_event_provider_idx" ON "build"."webhook_event" USING btree ("git_host_provider_id");

--> statement-breakpoint
-- ── build.git_repo_sync ────────────────────────────────────
ALTER TABLE "build"."git_repo_sync" ADD COLUMN "external_repo_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX "build_git_repo_sync_provider_external_unique" ON "build"."git_repo_sync" USING btree ("git_host_provider_id","external_repo_id");

--> statement-breakpoint
-- ── build.git_user_sync ────────────────────────────────────
ALTER TABLE "build"."git_user_sync" ADD COLUMN "external_user_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX "build_git_user_sync_provider_user_unique" ON "build"."git_user_sync" USING btree ("git_host_provider_id","external_user_id");

--> statement-breakpoint
-- ── build.work_item ────────────────────────────────────────
ALTER TABLE "build"."work_item" ADD COLUMN "status" text NOT NULL DEFAULT 'backlog';
--> statement-breakpoint
ALTER TABLE "build"."work_item" ADD COLUMN "external_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "build"."work_item" ADD COLUMN "assignee" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "build_work_item_provider_external_unique" ON "build"."work_item" USING btree ("work_tracker_provider_id","external_id");
--> statement-breakpoint
CREATE INDEX "build_work_item_status_idx" ON "build"."work_item" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "build_work_item_assignee_idx" ON "build"."work_item" USING btree ("assignee");

--> statement-breakpoint
-- ── build.pipeline_run ─────────────────────────────────────
ALTER TABLE "build"."pipeline_run" ADD COLUMN "status" text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "build"."pipeline_run" ADD COLUMN "commit_sha" text;
--> statement-breakpoint
CREATE INDEX "build_pipeline_run_status_idx" ON "build"."pipeline_run" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "build_pipeline_run_commit_idx" ON "build"."pipeline_run" USING btree ("commit_sha");
--> statement-breakpoint
ALTER TABLE "build"."pipeline_run" ADD CONSTRAINT "build_pipeline_run_status_valid" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled'));

--> statement-breakpoint
-- ── build.system_version ───────────────────────────────────
ALTER TABLE "build"."system_version" ADD COLUMN "version" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX "build_system_version_system_version_unique" ON "build"."system_version" USING btree ("system_id","version");

--> statement-breakpoint
-- ── infra.tunnel ───────────────────────────────────────────
ALTER TABLE "infra"."tunnel" ADD COLUMN "subdomain" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "infra"."tunnel" ADD COLUMN "phase" text NOT NULL DEFAULT 'connecting';
--> statement-breakpoint
CREATE UNIQUE INDEX "infra_tunnel_subdomain_unique" ON "infra"."tunnel" USING btree ("subdomain");
--> statement-breakpoint
CREATE INDEX "infra_tunnel_phase_idx" ON "infra"."tunnel" USING btree ("phase");
--> statement-breakpoint
ALTER TABLE "infra"."tunnel" ADD CONSTRAINT "infra_tunnel_phase_valid" CHECK ("phase" IN ('connecting', 'connected', 'disconnected', 'error'));

--> statement-breakpoint
-- ── infra.dns_domain ───────────────────────────────────────
ALTER TABLE "infra"."dns_domain" ADD COLUMN "fqdn" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX "infra_dns_domain_fqdn_unique" ON "infra"."dns_domain" USING btree ("fqdn");

--> statement-breakpoint
-- ── infra.ip_address ───────────────────────────────────────
ALTER TABLE "infra"."ip_address" ADD COLUMN "address" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX "infra_ip_address_unique" ON "infra"."ip_address" USING btree ("address");

--> statement-breakpoint
-- ── infra.route ────────────────────────────────────────────
ALTER TABLE "infra"."route" ADD COLUMN "domain" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX "infra_route_domain_idx" ON "infra"."route" USING btree ("domain");

--> statement-breakpoint
-- ── ops.preview ────────────────────────────────────────────
ALTER TABLE "ops"."preview" ADD COLUMN "phase" text NOT NULL DEFAULT 'pending_image';
--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD COLUMN "source_branch" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD COLUMN "pr_number" integer;
--> statement-breakpoint
CREATE INDEX "ops_preview_phase_idx" ON "ops"."preview" USING btree ("phase");
--> statement-breakpoint
CREATE INDEX "ops_preview_branch_idx" ON "ops"."preview" USING btree ("source_branch");
--> statement-breakpoint
CREATE INDEX "ops_preview_pr_idx" ON "ops"."preview" USING btree ("pr_number");
--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD CONSTRAINT "ops_preview_phase_valid" CHECK ("phase" IN ('pending_image', 'building', 'deploying', 'active', 'inactive', 'expired', 'failed'));

--> statement-breakpoint
-- ── org.config_var (new table) ───────────────────────────────
CREATE TABLE "org"."config_var" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "environment" text NOT NULL DEFAULT 'all',
  "value" text NOT NULL,
  "spec" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_config_var_slug_scope_env_unique" ON "org"."config_var" USING btree ("slug","scope_type","scope_id","environment");
--> statement-breakpoint
CREATE INDEX "org_config_var_scope_idx" ON "org"."config_var" USING btree ("scope_type","scope_id");
--> statement-breakpoint
CREATE INDEX "org_config_var_env_idx" ON "org"."config_var" USING btree ("environment");
--> statement-breakpoint
ALTER TABLE "org"."config_var" ADD CONSTRAINT "org_config_var_scope_type_valid" CHECK ("scope_type" IN ('org', 'team', 'principal', 'system'));

--> statement-breakpoint
-- ── org.secret (new table) ───────────────────────────────────
CREATE TABLE "org"."secret" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "environment" text NOT NULL DEFAULT 'all',
  "encrypted_value" text NOT NULL,
  "iv" text NOT NULL,
  "auth_tag" text NOT NULL,
  "key_version" integer NOT NULL DEFAULT 1,
  "created_by" text REFERENCES "org"."principal"("id") ON DELETE SET NULL,
  "spec" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_secret_slug_scope_env_unique" ON "org"."secret" USING btree ("slug","scope_type","scope_id","environment");
--> statement-breakpoint
CREATE INDEX "org_secret_scope_idx" ON "org"."secret" USING btree ("scope_type","scope_id");
--> statement-breakpoint
CREATE INDEX "org_secret_env_idx" ON "org"."secret" USING btree ("environment");
--> statement-breakpoint
CREATE INDEX "org_secret_key_version_idx" ON "org"."secret" USING btree ("key_version");
--> statement-breakpoint
ALTER TABLE "org"."secret" ADD CONSTRAINT "org_secret_scope_type_valid" CHECK ("scope_type" IN ('org', 'team', 'principal', 'system'));

--> statement-breakpoint
-- ── software.entity_relationship (new table) ─────────────────
CREATE TABLE "software"."entity_relationship" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" text NOT NULL,
  "target_kind" text NOT NULL,
  "target_id" text NOT NULL,
  "spec" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "software_entity_rel_unique" ON "software"."entity_relationship" USING btree ("type","source_kind","source_id","target_kind","target_id");
--> statement-breakpoint
CREATE INDEX "software_entity_rel_type_idx" ON "software"."entity_relationship" USING btree ("type");
--> statement-breakpoint
CREATE INDEX "software_entity_rel_source_idx" ON "software"."entity_relationship" USING btree ("source_kind","source_id");
--> statement-breakpoint
CREATE INDEX "software_entity_rel_target_idx" ON "software"."entity_relationship" USING btree ("target_kind","target_id");
--> statement-breakpoint
ALTER TABLE "software"."entity_relationship" ADD CONSTRAINT "software_entity_rel_type_valid" CHECK ("type" IN ('consumes-api', 'depends-on', 'provides', 'owned-by', 'deployed-alongside', 'triggers'));
