CREATE SCHEMA "factory_agent";
--> statement-breakpoint
CREATE SCHEMA "factory_build";
--> statement-breakpoint
CREATE SCHEMA "factory_catalog";
--> statement-breakpoint
CREATE SCHEMA "factory_commerce";
--> statement-breakpoint
CREATE SCHEMA "factory_fleet";
--> statement-breakpoint
CREATE SCHEMA "factory_infra";
--> statement-breakpoint
CREATE SCHEMA "factory_org";
--> statement-breakpoint
CREATE SCHEMA "factory_product";
--> statement-breakpoint
CREATE TABLE "factory_agent"."agent" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"agent_type" text NOT NULL,
	"principal_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"role_preset_slug" text,
	"autonomy_level" text DEFAULT 'executor' NOT NULL,
	"relationship" text DEFAULT 'team' NOT NULL,
	"relationship_entity_id" text,
	"collaboration_mode" text DEFAULT 'solo' NOT NULL,
	"reports_to_agent_id" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trust_score" real DEFAULT 0.5 NOT NULL,
	"guardrails" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_type_valid" CHECK ("factory_agent"."agent"."agent_type" IN ('engineering', 'qa', 'product', 'security', 'ops', 'external-mcp')),
	CONSTRAINT "agent_status_valid" CHECK ("factory_agent"."agent"."status" IN ('active', 'disabled')),
	CONSTRAINT "agent_autonomy_level_valid" CHECK ("factory_agent"."agent"."autonomy_level" IN ('observer', 'advisor', 'executor', 'operator', 'supervisor')),
	CONSTRAINT "agent_relationship_valid" CHECK ("factory_agent"."agent"."relationship" IN ('personal', 'team', 'org')),
	CONSTRAINT "agent_collaboration_mode_valid" CHECK ("factory_agent"."agent"."collaboration_mode" IN ('solo', 'pair', 'crew', 'hierarchy'))
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
CREATE TABLE "factory_agent"."job" (
	"job_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"mode" text NOT NULL,
	"trigger" text NOT NULL,
	"entity_kind" text,
	"entity_id" text,
	"channel_kind" text,
	"channel_id" text,
	"message_thread_id" text,
	"parent_job_id" text,
	"delegated_by_agent_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"task" text NOT NULL,
	"outcome" jsonb,
	"cost_cents" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"human_override" boolean DEFAULT false NOT NULL,
	"override_note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "job_mode_valid" CHECK ("factory_agent"."job"."mode" IN ('conversational', 'autonomous', 'observation')),
	CONSTRAINT "job_trigger_valid" CHECK ("factory_agent"."job"."trigger" IN ('mention', 'event', 'schedule', 'delegation', 'manual')),
	CONSTRAINT "job_status_valid" CHECK ("factory_agent"."job"."status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "job_channel_kind_valid" CHECK ("factory_agent"."job"."channel_kind" IS NULL OR "factory_agent"."job"."channel_kind" IN ('slack', 'cli', 'web', 'internal'))
);
--> statement-breakpoint
CREATE TABLE "factory_agent"."role_preset" (
	"role_preset_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"org_id" text,
	"description" text,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_build"."artifact" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'container_image' NOT NULL,
	"image_ref" text NOT NULL,
	"image_digest" text NOT NULL,
	"size_bytes" bigint,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_kind_valid" CHECK ("factory_build"."artifact"."kind" IN ('container_image', 'binary', 'archive', 'package', 'bundle'))
);
--> statement-breakpoint
CREATE TABLE "factory_build"."component_artifact" (
	"component_artifact_id" text PRIMARY KEY NOT NULL,
	"module_version_id" text NOT NULL,
	"component_id" text NOT NULL,
	"artifact_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_build"."git_host_provider" (
	"git_host_provider_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"host_type" text NOT NULL,
	"api_base_url" text NOT NULL,
	"auth_mode" text NOT NULL,
	"credentials_enc" text,
	"status" text DEFAULT 'active' NOT NULL,
	"team_id" text NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "git_host_provider_host_type_valid" CHECK ("factory_build"."git_host_provider"."host_type" IN ('github', 'gitlab', 'gitea', 'bitbucket')),
	CONSTRAINT "git_host_provider_auth_mode_valid" CHECK ("factory_build"."git_host_provider"."auth_mode" IN ('pat', 'github_app', 'oauth')),
	CONSTRAINT "git_host_provider_status_valid" CHECK ("factory_build"."git_host_provider"."status" IN ('active', 'inactive', 'error')),
	CONSTRAINT "git_host_provider_sync_status_valid" CHECK ("factory_build"."git_host_provider"."sync_status" IN ('idle', 'syncing', 'error'))
);
--> statement-breakpoint
CREATE TABLE "factory_build"."git_repo_sync" (
	"git_repo_sync_id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"git_host_provider_id" text NOT NULL,
	"external_repo_id" text NOT NULL,
	"external_full_name" text NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_build"."git_user_sync" (
	"git_user_sync_id" text PRIMARY KEY NOT NULL,
	"git_host_provider_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"external_login" text NOT NULL,
	"auth_user_id" text,
	"email" text,
	"name" text,
	"avatar_url" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_build"."github_app_installation" (
	"installation_id" text PRIMARY KEY NOT NULL,
	"git_host_provider_id" text NOT NULL,
	"github_app_id" text NOT NULL,
	"github_installation_id" text NOT NULL,
	"private_key_enc" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"permissions_granted" jsonb DEFAULT '{}'::jsonb,
	"account_login" text,
	"account_type" text,
	"token_expires_at" timestamp with time zone,
	"token_cache_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "factory_build"."repo" (
	"repo_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"module_id" text,
	"git_host_provider_id" text,
	"team_id" text NOT NULL,
	"git_url" text NOT NULL,
	"default_branch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_kind_valid" CHECK ("factory_build"."repo"."kind" IN ('product-module', 'platform-module', 'library', 'vendor-module', 'client-project', 'infra', 'docs', 'tool'))
);
--> statement-breakpoint
CREATE TABLE "factory_build"."webhook_event" (
	"webhook_event_id" text PRIMARY KEY NOT NULL,
	"git_host_provider_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"action" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_event_status_valid" CHECK ("factory_build"."webhook_event"."status" IN ('pending', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "factory_catalog"."api" (
	"api_id" text PRIMARY KEY NOT NULL,
	"system_id" text,
	"name" text NOT NULL,
	"namespace" text DEFAULT 'default' NOT NULL,
	"title" text,
	"description" text,
	"type" text NOT NULL,
	"lifecycle" text DEFAULT 'production',
	"owner_team_id" text,
	"definition" text,
	"provided_by_component_id" text,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_api_type_valid" CHECK ("factory_catalog"."api"."type" IN ('openapi', 'asyncapi', 'graphql', 'grpc')),
	CONSTRAINT "catalog_api_lifecycle_valid" CHECK ("factory_catalog"."api"."lifecycle" IN ('experimental', 'development', 'production', 'deprecated'))
);
--> statement-breakpoint
CREATE TABLE "factory_catalog"."component" (
	"component_id" text PRIMARY KEY NOT NULL,
	"system_id" text,
	"name" text NOT NULL,
	"namespace" text DEFAULT 'default' NOT NULL,
	"title" text,
	"description" text,
	"type" text NOT NULL,
	"lifecycle" text DEFAULT 'production',
	"owner_team_id" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"stateful" boolean DEFAULT false NOT NULL,
	"ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"healthcheck" jsonb,
	"replicas" integer DEFAULT 1 NOT NULL,
	"cpu" text DEFAULT '100m' NOT NULL,
	"memory" text DEFAULT '128Mi' NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_component_type_valid" CHECK ("factory_catalog"."component"."type" IN ('service', 'worker', 'task', 'cronjob', 'website', 'library')),
	CONSTRAINT "catalog_component_lifecycle_valid" CHECK ("factory_catalog"."component"."lifecycle" IN ('experimental', 'development', 'production', 'deprecated'))
);
--> statement-breakpoint
CREATE TABLE "factory_catalog"."domain" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"namespace" text DEFAULT 'default' NOT NULL,
	"title" text,
	"description" text,
	"owner_team_id" text,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_catalog"."entity_link" (
	"link_id" text PRIMARY KEY NOT NULL,
	"catalog_entity_kind" text NOT NULL,
	"catalog_entity_id" text NOT NULL,
	"factory_schema" text NOT NULL,
	"factory_table" text NOT NULL,
	"factory_entity_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_link_kind_valid" CHECK ("factory_catalog"."entity_link"."catalog_entity_kind" IN ('System', 'Domain', 'Component', 'Resource', 'API', 'Group', 'User'))
);
--> statement-breakpoint
CREATE TABLE "factory_catalog"."resource" (
	"resource_id" text PRIMARY KEY NOT NULL,
	"system_id" text,
	"name" text NOT NULL,
	"namespace" text DEFAULT 'default' NOT NULL,
	"title" text,
	"description" text,
	"type" text NOT NULL,
	"lifecycle" text DEFAULT 'production',
	"owner_team_id" text,
	"image" text,
	"ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"container_port" integer,
	"environment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"volumes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"healthcheck" text,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_resource_type_valid" CHECK ("factory_catalog"."resource"."type" IN ('database', 'cache', 'queue', 'gateway', 'storage', 'search')),
	CONSTRAINT "catalog_resource_lifecycle_valid" CHECK ("factory_catalog"."resource"."lifecycle" IN ('experimental', 'development', 'production', 'deprecated'))
);
--> statement-breakpoint
CREATE TABLE "factory_catalog"."system" (
	"system_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"namespace" text DEFAULT 'default' NOT NULL,
	"title" text,
	"description" text,
	"owner_team_id" text,
	"domain_id" text,
	"lifecycle" text DEFAULT 'production',
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"annotations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_system_lifecycle_valid" CHECK ("factory_catalog"."system"."lifecycle" IN ('experimental', 'development', 'production', 'deprecated'))
);
--> statement-breakpoint
CREATE TABLE "factory_commerce"."plan" (
	"plan_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"included_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_commerce"."customer_account" (
	"customer_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
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
	"expires_at" timestamp with time zone,
	"site_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_status_valid" CHECK ("factory_commerce"."entitlement"."status" IN ('active', 'suspended', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "factory_commerce"."entitlement_bundle" (
	"bundle_id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"site_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"grace_period_days" integer DEFAULT 30 NOT NULL
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
	"slug" text NOT NULL,
	"image" text NOT NULL,
	"port" integer NOT NULL,
	"env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"catalog_resource_id" text,
	"status" text DEFAULT 'provisioning' NOT NULL,
	CONSTRAINT "dependency_workload_status_valid" CHECK ("factory_fleet"."dependency_workload"."status" IN ('provisioning', 'running', 'failed', 'stopped'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."deployment_target" (
	"deployment_target_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"runtime" text DEFAULT 'kubernetes' NOT NULL,
	"host_id" text,
	"vm_id" text,
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
	CONSTRAINT "deployment_target_kind_valid" CHECK ("factory_fleet"."deployment_target"."kind" IN ('production', 'staging', 'sandbox', 'dev', 'preview')),
	CONSTRAINT "deployment_target_runtime_valid" CHECK ("factory_fleet"."deployment_target"."runtime" IN ('kubernetes', 'compose', 'systemd', 'windows_service', 'iis', 'process')),
	CONSTRAINT "deployment_target_trigger_valid" CHECK ("factory_fleet"."deployment_target"."trigger" IN ('manual', 'pr', 'release', 'agent', 'ci')),
	CONSTRAINT "deployment_target_status_valid" CHECK ("factory_fleet"."deployment_target"."status" IN ('provisioning', 'active', 'suspended', 'destroying', 'destroyed'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."site" (
	"site_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"product" text NOT NULL,
	"cluster_id" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checkin_at" timestamp with time zone,
	"current_manifest_version" integer,
	"preview_config" jsonb DEFAULT '{"enabled":false}'::jsonb NOT NULL,
	CONSTRAINT "fleet_site_status_valid" CHECK ("factory_fleet"."site"."status" IN ('provisioning', 'active', 'suspended', 'decommissioned'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."workbench" (
	"workbench_id" text PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'developer' NOT NULL,
	"hostname" text NOT NULL,
	"ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"os" text NOT NULL,
	"arch" text NOT NULL,
	"dx_version" text NOT NULL,
	"principal_id" text,
	"last_ping_at" timestamp with time zone,
	"last_command" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_workbench_type_valid" CHECK ("factory_fleet"."workbench"."type" IN ('developer', 'ci', 'agent', 'sandbox', 'build', 'testbed'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."forwarded_port" (
	"forwarded_port_id" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"tunnel_id" text,
	"port" integer NOT NULL,
	"label" text,
	"protocol" text DEFAULT 'http' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"detected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forwarded_port_protocol_valid" CHECK ("factory_fleet"."forwarded_port"."protocol" IN ('http', 'tcp')),
	CONSTRAINT "forwarded_port_status_valid" CHECK ("factory_fleet"."forwarded_port"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."install_manifest" (
	"install_manifest_id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"manifest_version" integer DEFAULT 1 NOT NULL,
	"role" text DEFAULT 'site' NOT NULL,
	"dx_version" text NOT NULL,
	"install_mode" text DEFAULT 'connected' NOT NULL,
	"k3s_version" text NOT NULL,
	"helm_chart_version" text NOT NULL,
	"site_name" text NOT NULL,
	"domain" text NOT NULL,
	"enabled_planes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"upgrades" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "install_manifest_role_valid" CHECK ("factory_fleet"."install_manifest"."role" IN ('site', 'factory')),
	CONSTRAINT "install_manifest_mode_valid" CHECK ("factory_fleet"."install_manifest"."install_mode" IN ('connected', 'offline'))
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
CREATE TABLE "factory_fleet"."preview" (
	"preview_id" text PRIMARY KEY NOT NULL,
	"deployment_target_id" text NOT NULL,
	"site_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"source_branch" text NOT NULL,
	"commit_sha" text NOT NULL,
	"repo" text NOT NULL,
	"pr_number" integer,
	"owner_id" text NOT NULL,
	"auth_mode" text DEFAULT 'team' NOT NULL,
	"runtime_class" text DEFAULT 'hot' NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"sandbox_id" text,
	"image_ref" text,
	"github_deployment_id" integer,
	"github_comment_id" integer,
	"status_message" text,
	"last_accessed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preview_auth_mode_valid" CHECK ("factory_fleet"."preview"."auth_mode" IN ('public', 'team', 'private')),
	CONSTRAINT "preview_runtime_class_valid" CHECK ("factory_fleet"."preview"."runtime_class" IN ('hot', 'warm', 'cold')),
	CONSTRAINT "preview_status_valid" CHECK ("factory_fleet"."preview"."status" IN ('pending_image', 'building', 'deploying', 'active', 'inactive', 'expired', 'failed'))
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
CREATE TABLE "factory_fleet"."release_bundle" (
	"release_bundle_id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"role" text DEFAULT 'site' NOT NULL,
	"arch" text DEFAULT 'amd64' NOT NULL,
	"dx_version" text NOT NULL,
	"k3s_version" text NOT NULL,
	"helm_chart_version" text NOT NULL,
	"image_count" integer DEFAULT 0 NOT NULL,
	"size_bytes" text,
	"checksum_sha256" text,
	"storage_path" text,
	"status" text DEFAULT 'building' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "release_bundle_role_valid" CHECK ("factory_fleet"."release_bundle"."role" IN ('site', 'factory')),
	CONSTRAINT "release_bundle_arch_valid" CHECK ("factory_fleet"."release_bundle"."arch" IN ('amd64', 'arm64')),
	CONSTRAINT "release_bundle_status_valid" CHECK ("factory_fleet"."release_bundle"."status" IN ('building', 'ready', 'failed', 'expired'))
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
CREATE TABLE "factory_fleet"."sandbox" (
	"sandbox_id" text PRIMARY KEY NOT NULL,
	"deployment_target_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"runtime_type" text NOT NULL,
	"vm_id" text,
	"pod_name" text,
	"devcontainer_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"devcontainer_image" text,
	"owner_id" text NOT NULL,
	"owner_type" text NOT NULL,
	"setup_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status_message" text,
	"repos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"docker_cache_gb" integer DEFAULT 20 NOT NULL,
	"cpu" text,
	"memory" text,
	"storage_gb" integer DEFAULT 10 NOT NULL,
	"ip_address" text,
	"auth_mode" text DEFAULT 'private' NOT NULL,
	"ssh_host" text,
	"ssh_port" integer,
	"web_terminal_url" text,
	"web_ide_url" text,
	"health_status" text DEFAULT 'unknown',
	"health_checked_at" timestamp with time zone,
	"cloned_from_snapshot_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_runtime_type_valid" CHECK ("factory_fleet"."sandbox"."runtime_type" IN ('container', 'vm')),
	CONSTRAINT "sandbox_owner_type_valid" CHECK ("factory_fleet"."sandbox"."owner_type" IN ('user', 'agent')),
	CONSTRAINT "sandbox_auth_mode_valid" CHECK ("factory_fleet"."sandbox"."auth_mode" IN ('public', 'team', 'private'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."sandbox_snapshot" (
	"sandbox_snapshot_id" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"runtime_type" text NOT NULL,
	"volume_snapshot_name" text,
	"image_ref" text,
	"external_snapshot_name" text,
	"vm_id" text,
	"snapshot_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"size_bytes" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_status_valid" CHECK ("factory_fleet"."sandbox_snapshot"."status" IN ('creating', 'ready', 'failed', 'deleted')),
	CONSTRAINT "snapshot_runtime_valid" CHECK ("factory_fleet"."sandbox_snapshot"."runtime_type" IN ('container', 'vm'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."sandbox_template" (
	"sandbox_template_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"runtime_type" text NOT NULL,
	"image" text,
	"default_cpu" text,
	"default_memory" text,
	"default_storage_gb" integer,
	"default_docker_cache_gb" integer,
	"vm_template_ref" text,
	"default_ttl_minutes" integer,
	"pre_installed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_template_runtime_valid" CHECK ("factory_fleet"."sandbox_template"."runtime_type" IN ('container', 'vm'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."site_manifest" (
	"manifest_id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"manifest_version" integer NOT NULL,
	"manifest_hash" text NOT NULL,
	"release_id" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"desired_artifact_uri" text,
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
CREATE TABLE "factory_fleet"."domain" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"site_id" text,
	"fqdn" text NOT NULL,
	"kind" text NOT NULL,
	"dns_verified" boolean DEFAULT false NOT NULL,
	"verification_token" text,
	"tls_cert_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_kind_valid" CHECK ("factory_fleet"."domain"."kind" IN ('primary', 'alias', 'custom', 'wildcard')),
	CONSTRAINT "domain_status_valid" CHECK ("factory_fleet"."domain"."status" IN ('pending', 'verified', 'active', 'error'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."route" (
	"route_id" text PRIMARY KEY NOT NULL,
	"site_id" text,
	"deployment_target_id" text,
	"cluster_id" text,
	"kind" text NOT NULL,
	"domain" text NOT NULL,
	"path_prefix" text,
	"target_service" text NOT NULL,
	"target_port" integer,
	"protocol" text DEFAULT 'http' NOT NULL,
	"tls_mode" text DEFAULT 'auto' NOT NULL,
	"tls_cert_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"middlewares" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_kind_valid" CHECK ("factory_fleet"."route"."kind" IN ('ingress', 'sandbox', 'preview', 'tunnel', 'custom_domain')),
	CONSTRAINT "route_protocol_valid" CHECK ("factory_fleet"."route"."protocol" IN ('http', 'grpc', 'tcp')),
	CONSTRAINT "route_tls_mode_valid" CHECK ("factory_fleet"."route"."tls_mode" IN ('auto', 'custom', 'none')),
	CONSTRAINT "route_status_valid" CHECK ("factory_fleet"."route"."status" IN ('pending', 'active', 'error', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "factory_fleet"."tunnel" (
	"tunnel_id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"subdomain" text NOT NULL,
	"local_addr" text NOT NULL,
	"mode" text DEFAULT 'http' NOT NULL,
	"tcp_port" integer,
	"broker_node_id" text,
	"status" text DEFAULT 'connecting' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "tunnel_status_valid" CHECK ("factory_fleet"."tunnel"."status" IN ('connecting', 'active', 'disconnected')),
	CONSTRAINT "tunnel_mode_valid" CHECK ("factory_fleet"."tunnel"."mode" IN ('http', 'tcp'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."cluster" (
	"cluster_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"provider_id" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"kubeconfig_ref" text,
	"endpoint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_status_valid" CHECK ("factory_infra"."cluster"."status" IN ('provisioning', 'ready', 'degraded', 'destroying'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."datacenter" (
	"datacenter_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"slug" text NOT NULL,
	"region_id" text NOT NULL,
	"availability_zone" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."host" (
	"host_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"hostname" text,
	"provider_id" text NOT NULL,
	"datacenter_id" text,
	"ip_address" text,
	"ipmi_address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"os_type" text DEFAULT 'linux' NOT NULL,
	"access_method" text DEFAULT 'ssh' NOT NULL,
	"cpu_cores" integer NOT NULL,
	"memory_mb" integer NOT NULL,
	"disk_gb" integer NOT NULL,
	"rack_location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_status_valid" CHECK ("factory_infra"."host"."status" IN ('active', 'maintenance', 'offline', 'decommissioned')),
	CONSTRAINT "host_os_type_valid" CHECK ("factory_infra"."host"."os_type" IN ('linux', 'windows')),
	CONSTRAINT "host_access_method_valid" CHECK ("factory_infra"."host"."access_method" IN ('ssh', 'winrm', 'rdp'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."ip_address" (
	"ip_address_id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"subnet_id" text,
	"assigned_to_type" text,
	"assigned_to_id" text,
	"status" text DEFAULT 'available' NOT NULL,
	"hostname" text,
	"fqdn" text,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ip_status_valid" CHECK ("factory_infra"."ip_address"."status" IN ('available', 'assigned', 'reserved', 'dhcp')),
	CONSTRAINT "ip_assigned_to_type_valid" CHECK ("factory_infra"."ip_address"."assigned_to_type" IS NULL OR "factory_infra"."ip_address"."assigned_to_type" IN ('vm', 'host', 'kube_node', 'cluster', 'service'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."kube_node" (
	"kube_node_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"cluster_id" text NOT NULL,
	"vm_id" text,
	"role" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"ip_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kube_node_role_valid" CHECK ("factory_infra"."kube_node"."role" IN ('server', 'agent')),
	CONSTRAINT "kube_node_status_valid" CHECK ("factory_infra"."kube_node"."status" IN ('ready', 'not_ready', 'paused', 'evacuating'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."provider" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"provider_type" text NOT NULL,
	"url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"credentials_ref" text,
	"provider_kind" text DEFAULT 'internal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."region" (
	"region_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"slug" text NOT NULL,
	"country" text,
	"city" text,
	"timezone" text,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."ssh_key" (
	"ssh_key_id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"key_type" text DEFAULT 'ed25519' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ssh_key_type_valid" CHECK ("factory_infra"."ssh_key"."key_type" IN ('ed25519', 'rsa', 'ecdsa')),
	CONSTRAINT "ssh_key_status_valid" CHECK ("factory_infra"."ssh_key"."status" IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."subnet" (
	"subnet_id" text PRIMARY KEY NOT NULL,
	"cidr" text NOT NULL,
	"gateway" text,
	"netmask" text,
	"vlan_id" integer,
	"vlan_name" text,
	"datacenter_id" text,
	"subnet_type" text DEFAULT 'vm' NOT NULL,
	"description" text,
	"dns_servers" text,
	"dns_domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subnet_type_valid" CHECK ("factory_infra"."subnet"."subnet_type" IN ('management', 'storage', 'vm', 'public', 'private', 'other'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."vm" (
	"vm_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"provider_id" text NOT NULL,
	"datacenter_id" text,
	"host_id" text,
	"cluster_id" text,
	"vm_cluster_id" text,
	"external_vmid" integer,
	"vm_type" text DEFAULT 'qemu' NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"os_type" text DEFAULT 'linux' NOT NULL,
	"access_method" text DEFAULT 'ssh' NOT NULL,
	"access_user" text,
	"cpu" integer NOT NULL,
	"memory_mb" integer NOT NULL,
	"disk_gb" integer NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vm_status_valid" CHECK ("factory_infra"."vm"."status" IN ('provisioning', 'running', 'stopped', 'destroying')),
	CONSTRAINT "vm_os_type_valid" CHECK ("factory_infra"."vm"."os_type" IN ('linux', 'windows')),
	CONSTRAINT "vm_access_method_valid" CHECK ("factory_infra"."vm"."access_method" IN ('ssh', 'winrm', 'rdp'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."vm_cluster" (
	"vm_cluster_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"provider_id" text NOT NULL,
	"api_host" text NOT NULL,
	"api_port" integer DEFAULT 8006 NOT NULL,
	"token_id" text,
	"token_secret" text,
	"ssl_fingerprint" text,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_status_valid" CHECK ("factory_infra"."vm_cluster"."sync_status" IN ('idle', 'syncing', 'error'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."channel_mapping" (
	"channel_mapping_id" text PRIMARY KEY NOT NULL,
	"messaging_provider_id" text NOT NULL,
	"external_channel_id" text NOT NULL,
	"external_channel_name" text,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_channel_mapping_entity_kind_valid" CHECK ("factory_org"."channel_mapping"."entity_kind" IN ('module', 'team', 'domain'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."identity_link" (
	"identity_link_id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_user_id" text NOT NULL,
	"external_login" text,
	"email" text,
	"auth_user_id" text,
	"profile_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text[],
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_error" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_identity_link_provider_valid" CHECK ("factory_org"."identity_link"."provider" IN ('github', 'google', 'slack', 'jira', 'claude', 'cursor')),
	CONSTRAINT "org_identity_link_sync_status_valid" CHECK ("factory_org"."identity_link"."sync_status" IN ('idle', 'syncing', 'error'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."memory" (
	"memory_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"layer" text NOT NULL,
	"layer_entity_id" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"embedding" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_job_id" text,
	"source_agent_id" text,
	"promoted_from_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"approved_by_principal_id" text,
	"last_accessed_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"superseded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_layer_valid" CHECK ("factory_org"."memory"."layer" IN ('session', 'team', 'org')),
	CONSTRAINT "memory_type_valid" CHECK ("factory_org"."memory"."type" IN ('fact', 'preference', 'decision', 'pattern', 'relationship', 'signal')),
	CONSTRAINT "memory_status_valid" CHECK ("factory_org"."memory"."status" IN ('proposed', 'active', 'archived', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."message_thread" (
	"message_thread_id" text PRIMARY KEY NOT NULL,
	"messaging_provider_id" text NOT NULL,
	"external_channel_id" text NOT NULL,
	"external_thread_id" text NOT NULL,
	"initiator_principal_id" text,
	"subject" text,
	"status" text DEFAULT 'active' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_message_thread_status_valid" CHECK ("factory_org"."message_thread"."status" IN ('active', 'resolved', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."messaging_provider" (
	"messaging_provider_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"team_id" text NOT NULL,
	"workspace_external_id" text,
	"bot_token_enc" text,
	"signing_secret" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_messaging_provider_kind_valid" CHECK ("factory_org"."messaging_provider"."kind" IN ('slack', 'teams', 'google-chat')),
	CONSTRAINT "org_messaging_provider_status_valid" CHECK ("factory_org"."messaging_provider"."status" IN ('active', 'inactive', 'error')),
	CONSTRAINT "org_messaging_provider_sync_status_valid" CHECK ("factory_org"."messaging_provider"."sync_status" IN ('idle', 'syncing', 'error'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."principal" (
	"principal_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"auth_user_id" text,
	"agent_id" text,
	"team_id" text,
	"email" text,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_principal_type_valid" CHECK ("factory_org"."principal"."type" IN ('user', 'agent', 'service_account')),
	CONSTRAINT "org_principal_status_valid" CHECK ("factory_org"."principal"."status" IN ('active', 'suspended', 'deactivated'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."principal_team_membership" (
	"membership_id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"team_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_membership_role_valid" CHECK ("factory_org"."principal_team_membership"."role" IN ('member', 'lead', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."scope" (
	"scope_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"parent_scope_id" text,
	"team_id" text,
	"resource_kind" text,
	"resource_id" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_scope_type_valid" CHECK ("factory_org"."scope"."type" IN ('team', 'resource', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."secret" (
	"secret_id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"environment" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_secret_scope_type_valid" CHECK ("factory_org"."secret"."scope_type" IN ('org', 'team', 'project', 'environment')),
	CONSTRAINT "org_secret_environment_valid" CHECK ("factory_org"."secret"."environment" IS NULL OR "factory_org"."secret"."environment" IN ('production', 'development', 'preview'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."team" (
	"team_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" text DEFAULT 'team' NOT NULL,
	"parent_team_id" text,
	"description" text,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_team_type_valid" CHECK ("factory_org"."team"."type" IN ('team', 'business-unit', 'product-area'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."tool_credential" (
	"tool_credential_id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"provider" text NOT NULL,
	"key_name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "org_tool_credential_status_valid" CHECK ("factory_org"."tool_credential"."status" IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "factory_org"."tool_usage" (
	"usage_id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"tool" text NOT NULL,
	"session_id" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0,
	"cost_microdollars" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_product"."component_spec" (
	"component_id" text PRIMARY KEY NOT NULL,
	"module_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"entity_kind" text DEFAULT 'Component' NOT NULL,
	"spec_type" text,
	"lifecycle" text DEFAULT 'production',
	"description" text,
	"ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"healthcheck" jsonb,
	"is_public" boolean DEFAULT false NOT NULL,
	"stateful" boolean DEFAULT false NOT NULL,
	"run_order" integer,
	"default_replicas" integer DEFAULT 1 NOT NULL,
	"default_cpu" text DEFAULT '100m' NOT NULL,
	"default_memory" text DEFAULT '128Mi' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "component_spec_kind_valid" CHECK ("factory_product"."component_spec"."kind" IN ('server', 'worker', 'task', 'scheduled', 'site', 'database', 'gateway')),
	CONSTRAINT "component_spec_entity_kind_valid" CHECK ("factory_product"."component_spec"."entity_kind" IN ('Component', 'Resource')),
	CONSTRAINT "component_spec_lifecycle_valid" CHECK ("factory_product"."component_spec"."lifecycle" IN ('experimental', 'development', 'production', 'deprecated'))
);
--> statement-breakpoint
CREATE TABLE "factory_product"."module" (
	"module_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"team_id" text NOT NULL,
	"product" text,
	"description" text,
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
	"kind" text DEFAULT 'story' NOT NULL,
	"priority" text,
	"description" text,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_work_item_id" text,
	"assignee" text,
	"external_id" text,
	"external_key" text,
	"external_url" text,
	"work_tracker_provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_status_valid" CHECK ("factory_product"."work_item"."status" IN ('backlog', 'ready', 'in_progress', 'in_review', 'done')),
	CONSTRAINT "work_item_kind_valid" CHECK ("factory_product"."work_item"."kind" IN ('epic', 'story', 'task', 'bug'))
);
--> statement-breakpoint
CREATE TABLE "factory_product"."work_tracker_project_mapping" (
	"mapping_id" text PRIMARY KEY NOT NULL,
	"work_tracker_provider_id" text NOT NULL,
	"module_id" text NOT NULL,
	"external_project_id" text NOT NULL,
	"external_project_name" text,
	"sync_direction" text DEFAULT 'pull' NOT NULL,
	"filter_query" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_direction_valid" CHECK ("factory_product"."work_tracker_project_mapping"."sync_direction" IN ('pull', 'push', 'bidirectional'))
);
--> statement-breakpoint
CREATE TABLE "factory_product"."work_tracker_provider" (
	"work_tracker_provider_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"api_url" text NOT NULL,
	"credentials_ref" text,
	"default_project_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"sync_interval_minutes" integer DEFAULT 5 NOT NULL,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_tracker_kind_valid" CHECK ("factory_product"."work_tracker_provider"."kind" IN ('jira', 'linear')),
	CONSTRAINT "work_tracker_status_valid" CHECK ("factory_product"."work_tracker_provider"."status" IN ('active', 'inactive')),
	CONSTRAINT "work_tracker_sync_status_valid" CHECK ("factory_product"."work_tracker_provider"."sync_status" IN ('idle', 'syncing', 'error'))
);
--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD CONSTRAINT "agent_principal_id_principal_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "factory_org"."principal"("principal_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_agent"."agent_execution" ADD CONSTRAINT "agent_execution_agent_id_agent_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "factory_agent"."agent"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_agent"."job" ADD CONSTRAINT "job_agent_id_agent_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "factory_agent"."agent"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_agent"."job" ADD CONSTRAINT "job_message_thread_id_message_thread_message_thread_id_fk" FOREIGN KEY ("message_thread_id") REFERENCES "factory_org"."message_thread"("message_thread_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_agent"."job" ADD CONSTRAINT "job_delegated_by_agent_id_agent_agent_id_fk" FOREIGN KEY ("delegated_by_agent_id") REFERENCES "factory_agent"."agent"("agent_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."component_artifact" ADD CONSTRAINT "component_artifact_module_version_id_module_version_module_version_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "factory_build"."module_version"("module_version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."component_artifact" ADD CONSTRAINT "component_artifact_component_id_component_spec_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "factory_product"."component_spec"("component_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."component_artifact" ADD CONSTRAINT "component_artifact_artifact_id_artifact_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "factory_build"."artifact"("artifact_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."git_host_provider" ADD CONSTRAINT "git_host_provider_team_id_team_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."git_repo_sync" ADD CONSTRAINT "git_repo_sync_repo_id_repo_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "factory_build"."repo"("repo_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."git_repo_sync" ADD CONSTRAINT "git_repo_sync_git_host_provider_id_git_host_provider_git_host_provider_id_fk" FOREIGN KEY ("git_host_provider_id") REFERENCES "factory_build"."git_host_provider"("git_host_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."git_user_sync" ADD CONSTRAINT "git_user_sync_git_host_provider_id_git_host_provider_git_host_provider_id_fk" FOREIGN KEY ("git_host_provider_id") REFERENCES "factory_build"."git_host_provider"("git_host_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."github_app_installation" ADD CONSTRAINT "github_app_installation_git_host_provider_id_git_host_provider_git_host_provider_id_fk" FOREIGN KEY ("git_host_provider_id") REFERENCES "factory_build"."git_host_provider"("git_host_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."module_version" ADD CONSTRAINT "module_version_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."pipeline_run" ADD CONSTRAINT "pipeline_run_repo_id_repo_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "factory_build"."repo"("repo_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."pipeline_run" ADD CONSTRAINT "pipeline_run_webhook_event_id_webhook_event_webhook_event_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "factory_build"."webhook_event"("webhook_event_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."pipeline_step_run" ADD CONSTRAINT "pipeline_step_run_pipeline_run_id_pipeline_run_pipeline_run_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "factory_build"."pipeline_run"("pipeline_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."repo" ADD CONSTRAINT "repo_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."repo" ADD CONSTRAINT "repo_git_host_provider_id_git_host_provider_git_host_provider_id_fk" FOREIGN KEY ("git_host_provider_id") REFERENCES "factory_build"."git_host_provider"("git_host_provider_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."repo" ADD CONSTRAINT "repo_team_id_team_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_build"."webhook_event" ADD CONSTRAINT "webhook_event_git_host_provider_id_git_host_provider_git_host_provider_id_fk" FOREIGN KEY ("git_host_provider_id") REFERENCES "factory_build"."git_host_provider"("git_host_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_catalog"."api" ADD CONSTRAINT "api_system_id_system_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "factory_catalog"."system"("system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_catalog"."api" ADD CONSTRAINT "api_owner_team_id_team_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_catalog"."api" ADD CONSTRAINT "api_provided_by_component_id_component_component_id_fk" FOREIGN KEY ("provided_by_component_id") REFERENCES "factory_catalog"."component"("component_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_catalog"."component" ADD CONSTRAINT "component_system_id_system_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "factory_catalog"."system"("system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_catalog"."component" ADD CONSTRAINT "component_owner_team_id_team_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_catalog"."domain" ADD CONSTRAINT "domain_owner_team_id_team_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_catalog"."resource" ADD CONSTRAINT "resource_system_id_system_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "factory_catalog"."system"("system_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_catalog"."resource" ADD CONSTRAINT "resource_owner_team_id_team_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_catalog"."system" ADD CONSTRAINT "system_owner_team_id_team_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_catalog"."system" ADD CONSTRAINT "system_domain_id_domain_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "factory_catalog"."domain"("domain_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_commerce"."entitlement" ADD CONSTRAINT "entitlement_customer_id_customer_account_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "factory_commerce"."customer_account"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_commerce"."entitlement" ADD CONSTRAINT "entitlement_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_commerce"."entitlement_bundle" ADD CONSTRAINT "entitlement_bundle_customer_id_customer_account_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "factory_commerce"."customer_account"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."connection_audit_event" ADD CONSTRAINT "connection_audit_event_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."dependency_workload" ADD CONSTRAINT "dependency_workload_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."dependency_workload" ADD CONSTRAINT "dependency_workload_catalog_resource_id_resource_resource_id_fk" FOREIGN KEY ("catalog_resource_id") REFERENCES "factory_catalog"."resource"("resource_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."deployment_target" ADD CONSTRAINT "deployment_target_host_id_host_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "factory_infra"."host"("host_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."deployment_target" ADD CONSTRAINT "deployment_target_vm_id_vm_vm_id_fk" FOREIGN KEY ("vm_id") REFERENCES "factory_infra"."vm"("vm_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."deployment_target" ADD CONSTRAINT "deployment_target_site_id_site_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."deployment_target" ADD CONSTRAINT "deployment_target_cluster_id_cluster_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "factory_infra"."cluster"("cluster_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."site" ADD CONSTRAINT "site_cluster_id_cluster_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "factory_infra"."cluster"("cluster_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."forwarded_port" ADD CONSTRAINT "forwarded_port_sandbox_id_sandbox_sandbox_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "factory_fleet"."sandbox"("sandbox_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."install_manifest" ADD CONSTRAINT "install_manifest_site_id_site_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."intervention" ADD CONSTRAINT "intervention_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."intervention" ADD CONSTRAINT "intervention_workload_id_workload_workload_id_fk" FOREIGN KEY ("workload_id") REFERENCES "factory_fleet"."workload"("workload_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."preview" ADD CONSTRAINT "preview_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."preview" ADD CONSTRAINT "preview_site_id_site_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."preview" ADD CONSTRAINT "preview_sandbox_id_sandbox_sandbox_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "factory_fleet"."sandbox"("sandbox_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."release_bundle" ADD CONSTRAINT "release_bundle_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "factory_fleet"."release"("release_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."release_module_pin" ADD CONSTRAINT "release_module_pin_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "factory_fleet"."release"("release_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."release_module_pin" ADD CONSTRAINT "release_module_pin_module_version_id_module_version_module_version_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "factory_build"."module_version"("module_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."rollout" ADD CONSTRAINT "rollout_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "factory_fleet"."release"("release_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."rollout" ADD CONSTRAINT "rollout_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."sandbox" ADD CONSTRAINT "sandbox_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."sandbox_snapshot" ADD CONSTRAINT "sandbox_snapshot_sandbox_id_sandbox_sandbox_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "factory_fleet"."sandbox"("sandbox_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."site_manifest" ADD CONSTRAINT "site_manifest_site_id_site_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."site_manifest" ADD CONSTRAINT "site_manifest_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "factory_fleet"."release"("release_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."workload" ADD CONSTRAINT "workload_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."workload" ADD CONSTRAINT "workload_module_version_id_module_version_module_version_id_fk" FOREIGN KEY ("module_version_id") REFERENCES "factory_build"."module_version"("module_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."workload" ADD CONSTRAINT "workload_component_id_component_spec_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "factory_product"."component_spec"("component_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."workload" ADD CONSTRAINT "workload_artifact_id_artifact_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "factory_build"."artifact"("artifact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."workload_override" ADD CONSTRAINT "workload_override_workload_id_workload_workload_id_fk" FOREIGN KEY ("workload_id") REFERENCES "factory_fleet"."workload"("workload_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."domain" ADD CONSTRAINT "domain_site_id_site_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."route" ADD CONSTRAINT "route_site_id_site_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."route" ADD CONSTRAINT "route_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."route" ADD CONSTRAINT "route_cluster_id_cluster_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "factory_infra"."cluster"("cluster_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."tunnel" ADD CONSTRAINT "tunnel_route_id_route_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "factory_fleet"."route"("route_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."cluster" ADD CONSTRAINT "cluster_provider_id_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "factory_infra"."provider"("provider_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."datacenter" ADD CONSTRAINT "datacenter_region_id_region_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "factory_infra"."region"("region_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."host" ADD CONSTRAINT "host_provider_id_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "factory_infra"."provider"("provider_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."host" ADD CONSTRAINT "host_datacenter_id_datacenter_datacenter_id_fk" FOREIGN KEY ("datacenter_id") REFERENCES "factory_infra"."datacenter"("datacenter_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."ip_address" ADD CONSTRAINT "ip_address_subnet_id_subnet_subnet_id_fk" FOREIGN KEY ("subnet_id") REFERENCES "factory_infra"."subnet"("subnet_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."kube_node" ADD CONSTRAINT "kube_node_cluster_id_cluster_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "factory_infra"."cluster"("cluster_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."kube_node" ADD CONSTRAINT "kube_node_vm_id_vm_vm_id_fk" FOREIGN KEY ("vm_id") REFERENCES "factory_infra"."vm"("vm_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."region" ADD CONSTRAINT "region_provider_id_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "factory_infra"."provider"("provider_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."subnet" ADD CONSTRAINT "subnet_datacenter_id_datacenter_datacenter_id_fk" FOREIGN KEY ("datacenter_id") REFERENCES "factory_infra"."datacenter"("datacenter_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD CONSTRAINT "vm_provider_id_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "factory_infra"."provider"("provider_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD CONSTRAINT "vm_datacenter_id_datacenter_datacenter_id_fk" FOREIGN KEY ("datacenter_id") REFERENCES "factory_infra"."datacenter"("datacenter_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD CONSTRAINT "vm_host_id_host_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "factory_infra"."host"("host_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD CONSTRAINT "vm_cluster_id_cluster_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "factory_infra"."cluster"("cluster_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD CONSTRAINT "vm_vm_cluster_id_vm_cluster_vm_cluster_id_fk" FOREIGN KEY ("vm_cluster_id") REFERENCES "factory_infra"."vm_cluster"("vm_cluster_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm_cluster" ADD CONSTRAINT "vm_cluster_provider_id_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "factory_infra"."provider"("provider_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."channel_mapping" ADD CONSTRAINT "channel_mapping_messaging_provider_id_messaging_provider_messaging_provider_id_fk" FOREIGN KEY ("messaging_provider_id") REFERENCES "factory_org"."messaging_provider"("messaging_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."identity_link" ADD CONSTRAINT "identity_link_principal_id_principal_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "factory_org"."principal"("principal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."memory" ADD CONSTRAINT "memory_approved_by_principal_id_principal_principal_id_fk" FOREIGN KEY ("approved_by_principal_id") REFERENCES "factory_org"."principal"("principal_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."message_thread" ADD CONSTRAINT "message_thread_messaging_provider_id_messaging_provider_messaging_provider_id_fk" FOREIGN KEY ("messaging_provider_id") REFERENCES "factory_org"."messaging_provider"("messaging_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."message_thread" ADD CONSTRAINT "message_thread_initiator_principal_id_principal_principal_id_fk" FOREIGN KEY ("initiator_principal_id") REFERENCES "factory_org"."principal"("principal_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."messaging_provider" ADD CONSTRAINT "messaging_provider_team_id_team_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."principal" ADD CONSTRAINT "principal_team_id_team_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."principal_team_membership" ADD CONSTRAINT "principal_team_membership_principal_id_principal_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "factory_org"."principal"("principal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."principal_team_membership" ADD CONSTRAINT "principal_team_membership_team_id_team_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."scope" ADD CONSTRAINT "scope_team_id_team_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."secret" ADD CONSTRAINT "secret_created_by_principal_principal_id_fk" FOREIGN KEY ("created_by") REFERENCES "factory_org"."principal"("principal_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."tool_credential" ADD CONSTRAINT "tool_credential_principal_id_principal_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "factory_org"."principal"("principal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."tool_usage" ADD CONSTRAINT "tool_usage_principal_id_principal_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "factory_org"."principal"("principal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_product"."component_spec" ADD CONSTRAINT "component_spec_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_product"."module" ADD CONSTRAINT "module_team_id_team_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_product"."work_item" ADD CONSTRAINT "work_item_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_product"."work_tracker_project_mapping" ADD CONSTRAINT "work_tracker_project_mapping_work_tracker_provider_id_work_tracker_provider_work_tracker_provider_id_fk" FOREIGN KEY ("work_tracker_provider_id") REFERENCES "factory_product"."work_tracker_provider"("work_tracker_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_product"."work_tracker_project_mapping" ADD CONSTRAINT "work_tracker_project_mapping_module_id_module_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "factory_product"."module"("module_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_name_unique" ON "factory_agent"."agent" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_slug_unique" ON "factory_agent"."agent" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "agent_preset_idx" ON "factory_agent"."agent" USING btree ("role_preset_slug");--> statement-breakpoint
CREATE INDEX "agent_relationship_idx" ON "factory_agent"."agent" USING btree ("relationship","relationship_entity_id");--> statement-breakpoint
CREATE INDEX "agent_reports_to_idx" ON "factory_agent"."agent" USING btree ("reports_to_agent_id");--> statement-breakpoint
CREATE INDEX "job_agent_idx" ON "factory_agent"."job" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "job_status_idx" ON "factory_agent"."job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_entity_idx" ON "factory_agent"."job" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "job_parent_idx" ON "factory_agent"."job" USING btree ("parent_job_id");--> statement-breakpoint
CREATE INDEX "job_message_thread_idx" ON "factory_agent"."job" USING btree ("message_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_preset_slug_unique" ON "factory_agent"."role_preset" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "role_preset_org_idx" ON "factory_agent"."role_preset" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_host_provider_slug_unique" ON "factory_build"."git_host_provider" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "git_repo_sync_provider_external_unique" ON "factory_build"."git_repo_sync" USING btree ("git_host_provider_id","external_repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_user_sync_provider_external_unique" ON "factory_build"."git_user_sync" USING btree ("git_host_provider_id","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "module_version_module_version_unique" ON "factory_build"."module_version" USING btree ("module_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_name_unique" ON "factory_build"."repo" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_slug_unique" ON "factory_build"."repo" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_delivery_unique" ON "factory_build"."webhook_event" USING btree ("git_host_provider_id","delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_api_sys_name_unique" ON "factory_catalog"."api" USING btree ("system_id","name");--> statement-breakpoint
CREATE INDEX "catalog_api_owner_idx" ON "factory_catalog"."api" USING btree ("owner_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_component_sys_name_unique" ON "factory_catalog"."component" USING btree ("system_id","name");--> statement-breakpoint
CREATE INDEX "catalog_component_owner_idx" ON "factory_catalog"."component" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX "catalog_component_type_idx" ON "factory_catalog"."component" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_domain_name_unique" ON "factory_catalog"."domain" USING btree ("name");--> statement-breakpoint
CREATE INDEX "catalog_domain_owner_idx" ON "factory_catalog"."domain" USING btree ("owner_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_link_catalog_unique" ON "factory_catalog"."entity_link" USING btree ("catalog_entity_kind","catalog_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_link_factory_unique" ON "factory_catalog"."entity_link" USING btree ("factory_schema","factory_table","factory_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_resource_sys_name_unique" ON "factory_catalog"."resource" USING btree ("system_id","name");--> statement-breakpoint
CREATE INDEX "catalog_resource_owner_idx" ON "factory_catalog"."resource" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX "catalog_resource_type_idx" ON "factory_catalog"."resource" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_system_ns_name_unique" ON "factory_catalog"."system" USING btree ("namespace","name");--> statement-breakpoint
CREATE INDEX "catalog_system_owner_idx" ON "factory_catalog"."system" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX "catalog_system_domain_idx" ON "factory_catalog"."system" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_plan_slug_unique" ON "factory_commerce"."plan" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_account_slug_unique" ON "factory_commerce"."customer_account" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "dependency_workload_target_slug_unique" ON "factory_fleet"."dependency_workload" USING btree ("deployment_target_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_target_name_unique" ON "factory_fleet"."deployment_target" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_target_slug_unique" ON "factory_fleet"."deployment_target" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "deployment_target_kind_status_idx" ON "factory_fleet"."deployment_target" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_site_name_unique" ON "factory_fleet"."site" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_site_slug_unique" ON "factory_fleet"."site" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "fleet_site_product_idx" ON "factory_fleet"."site" USING btree ("product");--> statement-breakpoint
CREATE INDEX "fleet_workbench_type_idx" ON "factory_fleet"."workbench" USING btree ("type");--> statement-breakpoint
CREATE INDEX "fleet_workbench_principal_idx" ON "factory_fleet"."workbench" USING btree ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forwarded_port_sandbox_port_unique" ON "factory_fleet"."forwarded_port" USING btree ("sandbox_id","port");--> statement-breakpoint
CREATE INDEX "forwarded_port_sandbox_idx" ON "factory_fleet"."forwarded_port" USING btree ("sandbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "install_manifest_site_id_unique" ON "factory_fleet"."install_manifest" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "install_manifest_role_idx" ON "factory_fleet"."install_manifest" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_slug_unique" ON "factory_fleet"."preview" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_deployment_target_unique" ON "factory_fleet"."preview" USING btree ("deployment_target_id");--> statement-breakpoint
CREATE INDEX "preview_site_idx" ON "factory_fleet"."preview" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "preview_status_idx" ON "factory_fleet"."preview" USING btree ("status");--> statement-breakpoint
CREATE INDEX "preview_branch_idx" ON "factory_fleet"."preview" USING btree ("source_branch");--> statement-breakpoint
CREATE UNIQUE INDEX "release_version_unique" ON "factory_fleet"."release" USING btree ("version");--> statement-breakpoint
CREATE INDEX "release_bundle_release_idx" ON "factory_fleet"."release_bundle" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "release_bundle_status_idx" ON "factory_fleet"."release_bundle" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rollout_release_idx" ON "factory_fleet"."rollout" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_deployment_target_unique" ON "factory_fleet"."sandbox" USING btree ("deployment_target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_slug_unique" ON "factory_fleet"."sandbox" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sandbox_owner_idx" ON "factory_fleet"."sandbox" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "sandbox_snapshot_sandbox_idx" ON "factory_fleet"."sandbox_snapshot" USING btree ("sandbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_template_slug_unique" ON "factory_fleet"."sandbox_template" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "site_manifest_site_version_unique" ON "factory_fleet"."site_manifest" USING btree ("site_id","manifest_version");--> statement-breakpoint
CREATE INDEX "site_manifest_site_latest_idx" ON "factory_fleet"."site_manifest" USING btree ("site_id","manifest_version");--> statement-breakpoint
CREATE INDEX "workload_target_component_idx" ON "factory_fleet"."workload" USING btree ("deployment_target_id","component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_fqdn_unique" ON "factory_fleet"."domain" USING btree ("fqdn");--> statement-breakpoint
CREATE INDEX "domain_site_idx" ON "factory_fleet"."domain" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "route_domain_path_unique" ON "factory_fleet"."route" USING btree ("domain","path_prefix");--> statement-breakpoint
CREATE INDEX "route_site_idx" ON "factory_fleet"."route" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "route_deployment_target_idx" ON "factory_fleet"."route" USING btree ("deployment_target_id");--> statement-breakpoint
CREATE INDEX "route_kind_status_idx" ON "factory_fleet"."route" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tunnel_subdomain_unique" ON "factory_fleet"."tunnel" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "tunnel_route_idx" ON "factory_fleet"."tunnel" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "tunnel_principal_idx" ON "factory_fleet"."tunnel" USING btree ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_name_unique" ON "factory_infra"."cluster" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_slug_unique" ON "factory_infra"."cluster" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "datacenter_name_region_unique" ON "factory_infra"."datacenter" USING btree ("name","region_id");--> statement-breakpoint
CREATE UNIQUE INDEX "datacenter_region_slug_unique" ON "factory_infra"."datacenter" USING btree ("region_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "host_name_unique" ON "factory_infra"."host" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "host_slug_unique" ON "factory_infra"."host" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ip_address_unique" ON "factory_infra"."ip_address" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "kube_node_cluster_name_unique" ON "factory_infra"."kube_node" USING btree ("cluster_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "kube_node_cluster_slug_unique" ON "factory_infra"."kube_node" USING btree ("cluster_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_slug_unique" ON "factory_infra"."provider" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "region_slug_unique" ON "factory_infra"."region" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_key_fingerprint_unique" ON "factory_infra"."ssh_key" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_key_principal_name_unique" ON "factory_infra"."ssh_key" USING btree ("principal_id","name");--> statement-breakpoint
CREATE INDEX "ssh_key_principal_idx" ON "factory_infra"."ssh_key" USING btree ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subnet_cidr_unique" ON "factory_infra"."subnet" USING btree ("cidr");--> statement-breakpoint
CREATE UNIQUE INDEX "vm_slug_unique" ON "factory_infra"."vm" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "vm_cluster_name_unique" ON "factory_infra"."vm_cluster" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "vm_cluster_slug_unique" ON "factory_infra"."vm_cluster" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "org_channel_mapping_provider_channel_unique" ON "factory_org"."channel_mapping" USING btree ("messaging_provider_id","external_channel_id");--> statement-breakpoint
CREATE INDEX "org_channel_mapping_entity_idx" ON "factory_org"."channel_mapping" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_identity_link_provider_external_unique" ON "factory_org"."identity_link" USING btree ("provider","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_identity_link_principal_provider_unique" ON "factory_org"."identity_link" USING btree ("principal_id","provider");--> statement-breakpoint
CREATE INDEX "org_identity_link_principal_idx" ON "factory_org"."identity_link" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "org_identity_link_email_idx" ON "factory_org"."identity_link" USING btree ("email");--> statement-breakpoint
CREATE INDEX "memory_org_layer_idx" ON "factory_org"."memory" USING btree ("org_id","layer");--> statement-breakpoint
CREATE INDEX "memory_layer_entity_idx" ON "factory_org"."memory" USING btree ("layer","layer_entity_id");--> statement-breakpoint
CREATE INDEX "memory_status_idx" ON "factory_org"."memory" USING btree ("status");--> statement-breakpoint
CREATE INDEX "memory_source_job_idx" ON "factory_org"."memory" USING btree ("source_job_id");--> statement-breakpoint
CREATE INDEX "memory_source_agent_idx" ON "factory_org"."memory" USING btree ("source_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_message_thread_provider_thread_unique" ON "factory_org"."message_thread" USING btree ("messaging_provider_id","external_thread_id");--> statement-breakpoint
CREATE INDEX "org_message_thread_channel_idx" ON "factory_org"."message_thread" USING btree ("messaging_provider_id","external_channel_id");--> statement-breakpoint
CREATE INDEX "org_message_thread_initiator_idx" ON "factory_org"."message_thread" USING btree ("initiator_principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_messaging_provider_slug_unique" ON "factory_org"."messaging_provider" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "org_messaging_provider_team_idx" ON "factory_org"."messaging_provider" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_principal_slug_unique" ON "factory_org"."principal" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "org_principal_auth_user_idx" ON "factory_org"."principal" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "org_principal_agent_idx" ON "factory_org"."principal" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "org_principal_team_idx" ON "factory_org"."principal" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_membership_unique" ON "factory_org"."principal_team_membership" USING btree ("principal_id","team_id");--> statement-breakpoint
CREATE INDEX "org_membership_team_idx" ON "factory_org"."principal_team_membership" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_scope_slug_unique" ON "factory_org"."scope" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "org_scope_parent_idx" ON "factory_org"."scope" USING btree ("parent_scope_id");--> statement-breakpoint
CREATE INDEX "org_scope_team_idx" ON "factory_org"."scope" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "org_scope_resource_idx" ON "factory_org"."scope" USING btree ("resource_kind","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_secret_key_scope_env_unique" ON "factory_org"."secret" USING btree ("key","scope_type","scope_id","environment");--> statement-breakpoint
CREATE INDEX "org_secret_scope_idx" ON "factory_org"."secret" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "org_secret_environment_idx" ON "factory_org"."secret" USING btree ("environment");--> statement-breakpoint
CREATE UNIQUE INDEX "org_team_slug_unique" ON "factory_org"."team" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "org_team_name_unique" ON "factory_org"."team" USING btree ("name");--> statement-breakpoint
CREATE INDEX "org_team_parent_idx" ON "factory_org"."team" USING btree ("parent_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_tool_credential_unique" ON "factory_org"."tool_credential" USING btree ("principal_id","provider","key_name");--> statement-breakpoint
CREATE INDEX "org_tool_usage_principal_recorded_idx" ON "factory_org"."tool_usage" USING btree ("principal_id","recorded_at");--> statement-breakpoint
CREATE INDEX "org_tool_usage_tool_recorded_idx" ON "factory_org"."tool_usage" USING btree ("tool","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "component_spec_module_name_unique" ON "factory_product"."component_spec" USING btree ("module_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "component_spec_module_slug_unique" ON "factory_product"."component_spec" USING btree ("module_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "module_name_unique" ON "factory_product"."module" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "module_slug_unique" ON "factory_product"."module" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "work_item_status_idx" ON "factory_product"."work_item" USING btree ("status");--> statement-breakpoint
CREATE INDEX "work_item_assignee_idx" ON "factory_product"."work_item" USING btree ("assignee");--> statement-breakpoint
CREATE UNIQUE INDEX "work_tracker_mapping_unique" ON "factory_product"."work_tracker_project_mapping" USING btree ("work_tracker_provider_id","module_id","external_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_tracker_provider_slug_unique" ON "factory_product"."work_tracker_provider" USING btree ("slug");