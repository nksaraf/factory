CREATE SCHEMA "build";
--> statement-breakpoint
CREATE SCHEMA "commerce";
--> statement-breakpoint
CREATE SCHEMA "infra";
--> statement-breakpoint
CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE SCHEMA "org";
--> statement-breakpoint
CREATE SCHEMA "software";
--> statement-breakpoint
CREATE TABLE "build"."component_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"system_version_id" text NOT NULL,
	"component_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build"."git_host_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_git_host_provider_type_valid" CHECK ("build"."git_host_provider"."type" IN ('github', 'gitlab', 'gitea', 'bitbucket'))
);
--> statement-breakpoint
CREATE TABLE "build"."git_repo_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"git_host_provider_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build"."git_user_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"git_host_provider_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build"."github_app_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"git_host_provider_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build"."pipeline_run" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"webhook_event_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build"."pipeline_step" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_run_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build"."repo" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"system_id" text,
	"git_host_provider_id" text,
	"team_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"system_from" timestamp with time zone DEFAULT now() NOT NULL,
	"system_to" timestamp with time zone,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "build"."system_version" (
	"id" text PRIMARY KEY NOT NULL,
	"system_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build"."webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build"."work_item" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"system_id" text,
	"work_tracker_provider_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_work_item_type_valid" CHECK ("build"."work_item"."type" IN ('epic', 'story', 'task', 'bug'))
);
--> statement-breakpoint
CREATE TABLE "build"."work_tracker_project_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"work_tracker_provider_id" text NOT NULL,
	"system_id" text NOT NULL,
	"external_project_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build"."work_tracker_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"team_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_work_tracker_provider_type_valid" CHECK ("build"."work_tracker_provider"."type" IN ('jira', 'linear'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."billable_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"capability_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."customer" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"system_from" timestamp with time zone DEFAULT now() NOT NULL,
	"system_to" timestamp with time zone,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "commerce"."entitlement_bundle" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce"."plan" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_plan_type_valid" CHECK ("commerce"."plan"."type" IN ('base', 'add-on', 'suite'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"system_from" timestamp with time zone DEFAULT now() NOT NULL,
	"system_to" timestamp with time zone,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "commerce"."subscription_item" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"capability_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra"."dns_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"site_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infra_dns_domain_type_valid" CHECK ("infra"."dns_domain"."type" IN ('primary', 'alias', 'custom', 'wildcard'))
);
--> statement-breakpoint
CREATE TABLE "infra"."host" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"substrate_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "infra_host_type_valid" CHECK ("infra"."host"."type" IN ('bare-metal', 'vm', 'lxc', 'cloud-instance'))
);
--> statement-breakpoint
CREATE TABLE "infra"."ip_address" (
	"id" text PRIMARY KEY NOT NULL,
	"subnet_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra"."route" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"site_id" text,
	"system_deployment_id" text,
	"runtime_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infra_route_type_valid" CHECK ("infra"."route"."type" IN ('ingress', 'sandbox', 'preview', 'tunnel', 'custom-domain'))
);
--> statement-breakpoint
CREATE TABLE "infra"."runtime" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parent_runtime_id" text,
	"host_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "infra_runtime_type_valid" CHECK ("infra"."runtime"."type" IN ('k8s-cluster', 'k8s-namespace', 'docker-engine', 'compose-project', 'systemd'))
);
--> statement-breakpoint
CREATE TABLE "infra"."secret" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra"."substrate" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parent_substrate_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "infra_substrate_type_valid" CHECK ("infra"."substrate"."type" IN ('cloud-account', 'region', 'datacenter', 'vpc', 'subnet', 'hypervisor', 'rack'))
);
--> statement-breakpoint
CREATE TABLE "infra"."tunnel" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"route_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "infra_tunnel_type_valid" CHECK ("infra"."tunnel"."type" IN ('http', 'tcp'))
);
--> statement-breakpoint
CREATE TABLE "ops"."anonymization_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."component_deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"system_deployment_id" text NOT NULL,
	"component_id" text NOT NULL,
	"artifact_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."connection_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"system_deployment_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."database_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"database_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "database_operation_type_valid" CHECK ("ops"."database_operation"."type" IN ('backup', 'restore', 'seed', 'anonymize'))
);
--> statement-breakpoint
CREATE TABLE "ops"."forwarded_port" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"workspace_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forwarded_port_type_valid" CHECK ("ops"."forwarded_port"."type" IN ('http', 'tcp'))
);
--> statement-breakpoint
CREATE TABLE "ops"."install_manifest" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."intervention" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"system_deployment_id" text,
	"component_deployment_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intervention_type_valid" CHECK ("ops"."intervention"."type" IN ('restart', 'scale', 'rollback', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "ops"."database" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"system_deployment_id" text,
	"component_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."preview" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"owner_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."rollout" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text,
	"system_deployment_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."site" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"system_from" timestamp with time zone DEFAULT now() NOT NULL,
	"system_to" timestamp with time zone,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "ops"."site_manifest" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"release_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."system_deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"system_id" text NOT NULL,
	"site_id" text NOT NULL,
	"runtime_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"system_from" timestamp with time zone DEFAULT now() NOT NULL,
	"system_to" timestamp with time zone,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"change_reason" text,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "system_deployment_type_valid" CHECK ("ops"."system_deployment"."type" IN ('production', 'staging', 'dev'))
);
--> statement-breakpoint
CREATE TABLE "ops"."workbench" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workbench_type_valid" CHECK ("ops"."workbench"."type" IN ('developer', 'ci', 'agent', 'build'))
);
--> statement-breakpoint
CREATE TABLE "ops"."workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"host_id" text,
	"runtime_id" text,
	"template_id" text,
	"owner_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"system_from" timestamp with time zone DEFAULT now() NOT NULL,
	"system_to" timestamp with time zone,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"change_reason" text,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "workspace_type_valid" CHECK ("ops"."workspace"."type" IN ('developer', 'agent', 'ci', 'playground'))
);
--> statement-breakpoint
CREATE TABLE "ops"."workspace_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."agent" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"principal_id" text NOT NULL,
	"reports_to_agent_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_agent_type_valid" CHECK ("org"."agent"."type" IN ('engineering', 'qa', 'product', 'security', 'ops', 'external-mcp'))
);
--> statement-breakpoint
CREATE TABLE "org"."identity_link" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"principal_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_identity_link_type_valid" CHECK ("org"."identity_link"."type" IN ('github', 'google', 'slack', 'jira', 'claude', 'cursor'))
);
--> statement-breakpoint
CREATE TABLE "org"."job" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"delegated_by_agent_id" text,
	"parent_job_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."membership" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"team_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."memory" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"approved_by_principal_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_memory_type_valid" CHECK ("org"."memory"."type" IN ('fact', 'preference', 'decision', 'pattern', 'relationship', 'signal'))
);
--> statement-breakpoint
CREATE TABLE "org"."messaging_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"team_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_messaging_provider_type_valid" CHECK ("org"."messaging_provider"."type" IN ('slack', 'teams', 'google-chat'))
);
--> statement-breakpoint
CREATE TABLE "org"."principal" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"primary_team_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"system_from" timestamp with time zone DEFAULT now() NOT NULL,
	"system_to" timestamp with time zone,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"change_reason" text,
	CONSTRAINT "org_principal_type_valid" CHECK ("org"."principal"."type" IN ('human', 'agent', 'service-account'))
);
--> statement-breakpoint
CREATE TABLE "org"."role_preset" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"org_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."scope" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"team_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_scope_type_valid" CHECK ("org"."scope"."type" IN ('team', 'resource', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "org"."ssh_key" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"principal_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_ssh_key_type_valid" CHECK ("org"."ssh_key"."type" IN ('ed25519', 'rsa', 'ecdsa'))
);
--> statement-breakpoint
CREATE TABLE "org"."team" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'team' NOT NULL,
	"parent_team_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"system_from" timestamp with time zone DEFAULT now() NOT NULL,
	"system_to" timestamp with time zone,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"change_reason" text,
	CONSTRAINT "org_team_type_valid" CHECK ("org"."team"."type" IN ('team', 'business-unit', 'product-area'))
);
--> statement-breakpoint
CREATE TABLE "org"."tool_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."tool_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "software"."artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"component_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "software_artifact_type_valid" CHECK ("software"."artifact"."type" IN ('container_image', 'binary', 'archive', 'package', 'bundle'))
);
--> statement-breakpoint
CREATE TABLE "software"."capability" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"product_id" text,
	"owner_team_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "software_capability_type_valid" CHECK ("software"."capability"."type" IN ('feature', 'integration', 'compute', 'data', 'support'))
);
--> statement-breakpoint
CREATE TABLE "software"."component" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"system_id" text NOT NULL,
	"owner_team_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"lifecycle" text DEFAULT 'production',
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"system_from" timestamp with time zone DEFAULT now() NOT NULL,
	"system_to" timestamp with time zone,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"change_reason" text,
	CONSTRAINT "software_component_type_valid" CHECK ("software"."component"."type" IN ('service', 'worker', 'task', 'cronjob', 'website', 'library', 'cli', 'agent', 'gateway', 'ml-model', 'database', 'cache', 'queue', 'storage', 'search'))
);
--> statement-breakpoint
CREATE TABLE "software"."product" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "software"."product_system" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"system_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "software"."release" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"system_id" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "software"."release_artifact_pin" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "software"."api" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"system_id" text NOT NULL,
	"provided_by_component_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "software_api_type_valid" CHECK ("software"."api"."type" IN ('openapi', 'grpc', 'graphql', 'asyncapi', 'webhook'))
);
--> statement-breakpoint
CREATE TABLE "software"."system" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"owner_team_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"system_from" timestamp with time zone DEFAULT now() NOT NULL,
	"system_to" timestamp with time zone,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE "software"."template" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "software_template_type_valid" CHECK ("software"."template"."type" IN ('component', 'system', 'workspace'))
);
--> statement-breakpoint
ALTER TABLE "build"."component_artifact" ADD CONSTRAINT "component_artifact_system_version_id_system_version_id_fk" FOREIGN KEY ("system_version_id") REFERENCES "build"."system_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."component_artifact" ADD CONSTRAINT "component_artifact_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "software"."component"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."component_artifact" ADD CONSTRAINT "component_artifact_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "software"."artifact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."git_repo_sync" ADD CONSTRAINT "git_repo_sync_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "build"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."git_repo_sync" ADD CONSTRAINT "git_repo_sync_git_host_provider_id_git_host_provider_id_fk" FOREIGN KEY ("git_host_provider_id") REFERENCES "build"."git_host_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."git_user_sync" ADD CONSTRAINT "git_user_sync_git_host_provider_id_git_host_provider_id_fk" FOREIGN KEY ("git_host_provider_id") REFERENCES "build"."git_host_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."github_app_installation" ADD CONSTRAINT "github_app_installation_git_host_provider_id_git_host_provider_id_fk" FOREIGN KEY ("git_host_provider_id") REFERENCES "build"."git_host_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."pipeline_run" ADD CONSTRAINT "pipeline_run_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "build"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."pipeline_run" ADD CONSTRAINT "pipeline_run_webhook_event_id_webhook_event_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "build"."webhook_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."pipeline_step" ADD CONSTRAINT "pipeline_step_pipeline_run_id_pipeline_run_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "build"."pipeline_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."repo" ADD CONSTRAINT "repo_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "software"."system"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."repo" ADD CONSTRAINT "repo_git_host_provider_id_git_host_provider_id_fk" FOREIGN KEY ("git_host_provider_id") REFERENCES "build"."git_host_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."repo" ADD CONSTRAINT "repo_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "org"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."system_version" ADD CONSTRAINT "system_version_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "software"."system"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."work_item" ADD CONSTRAINT "work_item_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "software"."system"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."work_item" ADD CONSTRAINT "work_item_work_tracker_provider_id_work_tracker_provider_id_fk" FOREIGN KEY ("work_tracker_provider_id") REFERENCES "build"."work_tracker_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."work_tracker_project_mapping" ADD CONSTRAINT "work_tracker_project_mapping_work_tracker_provider_id_work_tracker_provider_id_fk" FOREIGN KEY ("work_tracker_provider_id") REFERENCES "build"."work_tracker_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."work_tracker_project_mapping" ADD CONSTRAINT "work_tracker_project_mapping_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "software"."system"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build"."work_tracker_provider" ADD CONSTRAINT "work_tracker_provider_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "org"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."billable_metric" ADD CONSTRAINT "billable_metric_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "software"."capability"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."entitlement_bundle" ADD CONSTRAINT "entitlement_bundle_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "commerce"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."subscription" ADD CONSTRAINT "subscription_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "commerce"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."subscription" ADD CONSTRAINT "subscription_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."subscription_item" ADD CONSTRAINT "subscription_item_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "commerce"."subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."subscription_item" ADD CONSTRAINT "subscription_item_capability_id_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "software"."capability"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."host" ADD CONSTRAINT "host_substrate_id_substrate_id_fk" FOREIGN KEY ("substrate_id") REFERENCES "infra"."substrate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."ip_address" ADD CONSTRAINT "ip_address_subnet_id_substrate_id_fk" FOREIGN KEY ("subnet_id") REFERENCES "infra"."substrate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."route" ADD CONSTRAINT "route_runtime_id_runtime_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "infra"."runtime"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."runtime" ADD CONSTRAINT "runtime_parent_runtime_id_runtime_id_fk" FOREIGN KEY ("parent_runtime_id") REFERENCES "infra"."runtime"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."runtime" ADD CONSTRAINT "runtime_host_id_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "infra"."host"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."substrate" ADD CONSTRAINT "substrate_parent_substrate_id_substrate_id_fk" FOREIGN KEY ("parent_substrate_id") REFERENCES "infra"."substrate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."tunnel" ADD CONSTRAINT "tunnel_route_id_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "infra"."route"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."tunnel" ADD CONSTRAINT "tunnel_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "org"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."component_deployment" ADD CONSTRAINT "component_deployment_system_deployment_id_system_deployment_id_fk" FOREIGN KEY ("system_deployment_id") REFERENCES "ops"."system_deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."component_deployment" ADD CONSTRAINT "component_deployment_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "software"."component"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."component_deployment" ADD CONSTRAINT "component_deployment_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "software"."artifact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."connection_audit_event" ADD CONSTRAINT "connection_audit_event_system_deployment_id_system_deployment_id_fk" FOREIGN KEY ("system_deployment_id") REFERENCES "ops"."system_deployment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."database_operation" ADD CONSTRAINT "database_operation_database_id_database_id_fk" FOREIGN KEY ("database_id") REFERENCES "ops"."database"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."forwarded_port" ADD CONSTRAINT "forwarded_port_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "ops"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."install_manifest" ADD CONSTRAINT "install_manifest_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "ops"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."intervention" ADD CONSTRAINT "intervention_system_deployment_id_system_deployment_id_fk" FOREIGN KEY ("system_deployment_id") REFERENCES "ops"."system_deployment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."intervention" ADD CONSTRAINT "intervention_component_deployment_id_component_deployment_id_fk" FOREIGN KEY ("component_deployment_id") REFERENCES "ops"."component_deployment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."database" ADD CONSTRAINT "database_system_deployment_id_system_deployment_id_fk" FOREIGN KEY ("system_deployment_id") REFERENCES "ops"."system_deployment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."database" ADD CONSTRAINT "database_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "software"."component"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD CONSTRAINT "preview_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "ops"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."preview" ADD CONSTRAINT "preview_owner_id_principal_id_fk" FOREIGN KEY ("owner_id") REFERENCES "org"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."rollout" ADD CONSTRAINT "rollout_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "software"."release"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."rollout" ADD CONSTRAINT "rollout_system_deployment_id_system_deployment_id_fk" FOREIGN KEY ("system_deployment_id") REFERENCES "ops"."system_deployment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."site_manifest" ADD CONSTRAINT "site_manifest_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "ops"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."site_manifest" ADD CONSTRAINT "site_manifest_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "software"."release"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."system_deployment" ADD CONSTRAINT "system_deployment_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "software"."system"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."system_deployment" ADD CONSTRAINT "system_deployment_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "ops"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."system_deployment" ADD CONSTRAINT "system_deployment_runtime_id_runtime_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "infra"."runtime"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workspace" ADD CONSTRAINT "workspace_host_id_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "infra"."host"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workspace" ADD CONSTRAINT "workspace_runtime_id_runtime_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "infra"."runtime"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workspace" ADD CONSTRAINT "workspace_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "software"."template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workspace" ADD CONSTRAINT "workspace_owner_id_principal_id_fk" FOREIGN KEY ("owner_id") REFERENCES "org"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workspace_snapshot" ADD CONSTRAINT "workspace_snapshot_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "ops"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."agent" ADD CONSTRAINT "agent_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "org"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."identity_link" ADD CONSTRAINT "identity_link_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "org"."principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."job" ADD CONSTRAINT "job_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "org"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."job" ADD CONSTRAINT "job_delegated_by_agent_id_agent_id_fk" FOREIGN KEY ("delegated_by_agent_id") REFERENCES "org"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."membership" ADD CONSTRAINT "membership_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "org"."principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."membership" ADD CONSTRAINT "membership_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "org"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."memory" ADD CONSTRAINT "memory_approved_by_principal_id_principal_id_fk" FOREIGN KEY ("approved_by_principal_id") REFERENCES "org"."principal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."messaging_provider" ADD CONSTRAINT "messaging_provider_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "org"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."principal" ADD CONSTRAINT "principal_primary_team_id_team_id_fk" FOREIGN KEY ("primary_team_id") REFERENCES "org"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."scope" ADD CONSTRAINT "scope_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "org"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."ssh_key" ADD CONSTRAINT "ssh_key_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "org"."principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."team" ADD CONSTRAINT "team_parent_team_id_team_id_fk" FOREIGN KEY ("parent_team_id") REFERENCES "org"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."tool_credential" ADD CONSTRAINT "tool_credential_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "org"."principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."tool_usage" ADD CONSTRAINT "tool_usage_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "org"."principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."artifact" ADD CONSTRAINT "artifact_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "software"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."capability" ADD CONSTRAINT "capability_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "software"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."capability" ADD CONSTRAINT "capability_owner_team_id_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "org"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."component" ADD CONSTRAINT "component_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "software"."system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."component" ADD CONSTRAINT "component_owner_team_id_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "org"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."product_system" ADD CONSTRAINT "product_system_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "software"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."product_system" ADD CONSTRAINT "product_system_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "software"."system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."release" ADD CONSTRAINT "release_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "software"."system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."release_artifact_pin" ADD CONSTRAINT "release_artifact_pin_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "software"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."release_artifact_pin" ADD CONSTRAINT "release_artifact_pin_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "software"."artifact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."api" ADD CONSTRAINT "api_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "software"."system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."api" ADD CONSTRAINT "api_provided_by_component_id_component_id_fk" FOREIGN KEY ("provided_by_component_id") REFERENCES "software"."component"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "software"."system" ADD CONSTRAINT "system_owner_team_id_team_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "org"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "build_component_artifact_unique" ON "build"."component_artifact" USING btree ("system_version_id","component_id","artifact_id");--> statement-breakpoint
CREATE INDEX "build_component_artifact_version_idx" ON "build"."component_artifact" USING btree ("system_version_id");--> statement-breakpoint
CREATE INDEX "build_component_artifact_component_idx" ON "build"."component_artifact" USING btree ("component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "build_git_host_provider_slug_unique" ON "build"."git_host_provider" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "build_git_host_provider_type_idx" ON "build"."git_host_provider" USING btree ("type");--> statement-breakpoint
CREATE INDEX "build_git_repo_sync_repo_idx" ON "build"."git_repo_sync" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "build_git_repo_sync_git_host_provider_idx" ON "build"."git_repo_sync" USING btree ("git_host_provider_id");--> statement-breakpoint
CREATE INDEX "build_git_user_sync_git_host_provider_idx" ON "build"."git_user_sync" USING btree ("git_host_provider_id");--> statement-breakpoint
CREATE INDEX "build_github_app_installation_git_host_provider_idx" ON "build"."github_app_installation" USING btree ("git_host_provider_id");--> statement-breakpoint
CREATE INDEX "build_pipeline_run_repo_idx" ON "build"."pipeline_run" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "build_pipeline_run_webhook_event_idx" ON "build"."pipeline_run" USING btree ("webhook_event_id");--> statement-breakpoint
CREATE INDEX "build_pipeline_step_pipeline_run_idx" ON "build"."pipeline_step" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "build_repo_slug_idx" ON "build"."repo" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "build_repo_system_idx" ON "build"."repo" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "build_repo_git_host_provider_idx" ON "build"."repo" USING btree ("git_host_provider_id");--> statement-breakpoint
CREATE INDEX "build_repo_team_idx" ON "build"."repo" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "build_system_version_system_idx" ON "build"."system_version" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "build_work_item_type_idx" ON "build"."work_item" USING btree ("type");--> statement-breakpoint
CREATE INDEX "build_work_item_system_idx" ON "build"."work_item" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "build_work_item_work_tracker_provider_idx" ON "build"."work_item" USING btree ("work_tracker_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "build_work_tracker_project_mapping_provider_system_unique" ON "build"."work_tracker_project_mapping" USING btree ("work_tracker_provider_id","system_id");--> statement-breakpoint
CREATE INDEX "build_work_tracker_project_mapping_system_idx" ON "build"."work_tracker_project_mapping" USING btree ("system_id");--> statement-breakpoint
CREATE UNIQUE INDEX "build_work_tracker_provider_slug_unique" ON "build"."work_tracker_provider" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "build_work_tracker_provider_type_idx" ON "build"."work_tracker_provider" USING btree ("type");--> statement-breakpoint
CREATE INDEX "build_work_tracker_provider_team_idx" ON "build"."work_tracker_provider" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_billable_metric_slug_unique" ON "commerce"."billable_metric" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_billable_metric_name_unique" ON "commerce"."billable_metric" USING btree ("name");--> statement-breakpoint
CREATE INDEX "commerce_billable_metric_capability_idx" ON "commerce"."billable_metric" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "commerce_customer_slug_idx" ON "commerce"."customer" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "commerce_customer_name_idx" ON "commerce"."customer" USING btree ("name");--> statement-breakpoint
CREATE INDEX "commerce_entitlement_bundle_customer_idx" ON "commerce"."entitlement_bundle" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_plan_slug_unique" ON "commerce"."plan" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_plan_name_unique" ON "commerce"."plan" USING btree ("name");--> statement-breakpoint
CREATE INDEX "commerce_plan_type_idx" ON "commerce"."plan" USING btree ("type");--> statement-breakpoint
CREATE INDEX "commerce_subscription_customer_idx" ON "commerce"."subscription" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "commerce_subscription_plan_idx" ON "commerce"."subscription" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "commerce_subscription_item_subscription_idx" ON "commerce"."subscription_item" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "commerce_subscription_item_capability_idx" ON "commerce"."subscription_item" USING btree ("capability_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_dns_domain_slug_unique" ON "infra"."dns_domain" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "infra_dns_domain_type_idx" ON "infra"."dns_domain" USING btree ("type");--> statement-breakpoint
CREATE INDEX "infra_dns_domain_site_idx" ON "infra"."dns_domain" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_host_slug_unique" ON "infra"."host" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "infra_host_type_idx" ON "infra"."host" USING btree ("type");--> statement-breakpoint
CREATE INDEX "infra_host_substrate_idx" ON "infra"."host" USING btree ("substrate_id");--> statement-breakpoint
CREATE INDEX "infra_ip_address_subnet_idx" ON "infra"."ip_address" USING btree ("subnet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_route_slug_unique" ON "infra"."route" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "infra_route_type_idx" ON "infra"."route" USING btree ("type");--> statement-breakpoint
CREATE INDEX "infra_route_site_idx" ON "infra"."route" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "infra_route_system_deployment_idx" ON "infra"."route" USING btree ("system_deployment_id");--> statement-breakpoint
CREATE INDEX "infra_route_runtime_idx" ON "infra"."route" USING btree ("runtime_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_runtime_slug_unique" ON "infra"."runtime" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "infra_runtime_type_idx" ON "infra"."runtime" USING btree ("type");--> statement-breakpoint
CREATE INDEX "infra_runtime_parent_idx" ON "infra"."runtime" USING btree ("parent_runtime_id");--> statement-breakpoint
CREATE INDEX "infra_runtime_host_idx" ON "infra"."runtime" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_secret_slug_unique" ON "infra"."secret" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_substrate_slug_unique" ON "infra"."substrate" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "infra_substrate_type_idx" ON "infra"."substrate" USING btree ("type");--> statement-breakpoint
CREATE INDEX "infra_substrate_parent_idx" ON "infra"."substrate" USING btree ("parent_substrate_id");--> statement-breakpoint
CREATE INDEX "infra_tunnel_type_idx" ON "infra"."tunnel" USING btree ("type");--> statement-breakpoint
CREATE INDEX "infra_tunnel_route_idx" ON "infra"."tunnel" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "infra_tunnel_principal_idx" ON "infra"."tunnel" USING btree ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_anonymization_profile_slug_unique" ON "ops"."anonymization_profile" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_component_deployment_sd_component_unique" ON "ops"."component_deployment" USING btree ("system_deployment_id","component_id");--> statement-breakpoint
CREATE INDEX "ops_component_deployment_sd_idx" ON "ops"."component_deployment" USING btree ("system_deployment_id");--> statement-breakpoint
CREATE INDEX "ops_component_deployment_component_idx" ON "ops"."component_deployment" USING btree ("component_id");--> statement-breakpoint
CREATE INDEX "ops_component_deployment_artifact_idx" ON "ops"."component_deployment" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "ops_connection_audit_sd_idx" ON "ops"."connection_audit_event" USING btree ("system_deployment_id");--> statement-breakpoint
CREATE INDEX "ops_database_operation_db_idx" ON "ops"."database_operation" USING btree ("database_id");--> statement-breakpoint
CREATE INDEX "ops_database_operation_type_idx" ON "ops"."database_operation" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ops_forwarded_port_type_idx" ON "ops"."forwarded_port" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ops_forwarded_port_workspace_idx" ON "ops"."forwarded_port" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ops_install_manifest_site_idx" ON "ops"."install_manifest" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "ops_intervention_type_idx" ON "ops"."intervention" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ops_intervention_sd_idx" ON "ops"."intervention" USING btree ("system_deployment_id");--> statement-breakpoint
CREATE INDEX "ops_intervention_cd_idx" ON "ops"."intervention" USING btree ("component_deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_database_slug_unique" ON "ops"."database" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ops_database_sd_idx" ON "ops"."database" USING btree ("system_deployment_id");--> statement-breakpoint
CREATE INDEX "ops_database_component_idx" ON "ops"."database" USING btree ("component_id");--> statement-breakpoint
CREATE INDEX "ops_preview_site_idx" ON "ops"."preview" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "ops_preview_owner_idx" ON "ops"."preview" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "ops_rollout_release_idx" ON "ops"."rollout" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "ops_rollout_sd_idx" ON "ops"."rollout" USING btree ("system_deployment_id");--> statement-breakpoint
CREATE INDEX "ops_site_slug_idx" ON "ops"."site" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ops_site_name_idx" ON "ops"."site" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ops_site_manifest_site_idx" ON "ops"."site_manifest" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "ops_site_manifest_release_idx" ON "ops"."site_manifest" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "ops_system_deployment_site_slug_idx" ON "ops"."system_deployment" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "ops_system_deployment_system_idx" ON "ops"."system_deployment" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "ops_system_deployment_runtime_idx" ON "ops"."system_deployment" USING btree ("runtime_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ops_workbench_slug_unique" ON "ops"."workbench" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ops_workbench_type_idx" ON "ops"."workbench" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ops_workspace_slug_idx" ON "ops"."workspace" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ops_workspace_type_idx" ON "ops"."workspace" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ops_workspace_host_idx" ON "ops"."workspace" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "ops_workspace_runtime_idx" ON "ops"."workspace" USING btree ("runtime_id");--> statement-breakpoint
CREATE INDEX "ops_workspace_owner_idx" ON "ops"."workspace" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "ops_workspace_snapshot_workspace_idx" ON "ops"."workspace_snapshot" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_agent_slug_unique" ON "org"."agent" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "org_agent_name_unique" ON "org"."agent" USING btree ("name");--> statement-breakpoint
CREATE INDEX "org_agent_type_idx" ON "org"."agent" USING btree ("type");--> statement-breakpoint
CREATE INDEX "org_agent_principal_idx" ON "org"."agent" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "org_agent_reports_to_idx" ON "org"."agent" USING btree ("reports_to_agent_id");--> statement-breakpoint
CREATE INDEX "org_identity_link_type_idx" ON "org"."identity_link" USING btree ("type");--> statement-breakpoint
CREATE INDEX "org_identity_link_principal_idx" ON "org"."identity_link" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "org_job_agent_idx" ON "org"."job" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "org_job_delegated_by_idx" ON "org"."job" USING btree ("delegated_by_agent_id");--> statement-breakpoint
CREATE INDEX "org_job_parent_idx" ON "org"."job" USING btree ("parent_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_membership_principal_team_unique" ON "org"."membership" USING btree ("principal_id","team_id");--> statement-breakpoint
CREATE INDEX "org_membership_team_idx" ON "org"."membership" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "org_memory_type_idx" ON "org"."memory" USING btree ("type");--> statement-breakpoint
CREATE INDEX "org_memory_approved_by_idx" ON "org"."memory" USING btree ("approved_by_principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_messaging_provider_slug_unique" ON "org"."messaging_provider" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "org_messaging_provider_type_idx" ON "org"."messaging_provider" USING btree ("type");--> statement-breakpoint
CREATE INDEX "org_messaging_provider_team_idx" ON "org"."messaging_provider" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "org_principal_slug_idx" ON "org"."principal" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "org_principal_type_idx" ON "org"."principal" USING btree ("type");--> statement-breakpoint
CREATE INDEX "org_principal_primary_team_idx" ON "org"."principal" USING btree ("primary_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_role_preset_slug_unique" ON "org"."role_preset" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "org_role_preset_org_idx" ON "org"."role_preset" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_scope_slug_unique" ON "org"."scope" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "org_scope_type_idx" ON "org"."scope" USING btree ("type");--> statement-breakpoint
CREATE INDEX "org_scope_team_idx" ON "org"."scope" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "org_ssh_key_type_idx" ON "org"."ssh_key" USING btree ("type");--> statement-breakpoint
CREATE INDEX "org_ssh_key_principal_idx" ON "org"."ssh_key" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "org_team_slug_idx" ON "org"."team" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "org_team_name_idx" ON "org"."team" USING btree ("name");--> statement-breakpoint
CREATE INDEX "org_team_parent_team_idx" ON "org"."team" USING btree ("parent_team_id");--> statement-breakpoint
CREATE INDEX "org_team_type_idx" ON "org"."team" USING btree ("type");--> statement-breakpoint
CREATE INDEX "org_tool_credential_principal_idx" ON "org"."tool_credential" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "org_tool_usage_principal_idx" ON "org"."tool_usage" USING btree ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "software_capability_slug_unique" ON "software"."capability" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "software_component_system_slug_idx" ON "software"."component" USING btree ("system_id","slug");--> statement-breakpoint
CREATE INDEX "software_component_system_name_idx" ON "software"."component" USING btree ("system_id","name");--> statement-breakpoint
CREATE INDEX "software_component_type_idx" ON "software"."component" USING btree ("type");--> statement-breakpoint
CREATE INDEX "software_component_owner_team_idx" ON "software"."component" USING btree ("owner_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "software_product_slug_unique" ON "software"."product" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "software_product_name_unique" ON "software"."product" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "software_product_system_unique" ON "software"."product_system" USING btree ("product_id","system_id");--> statement-breakpoint
CREATE UNIQUE INDEX "software_release_system_slug_unique" ON "software"."release" USING btree ("system_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "software_release_artifact_pin_unique" ON "software"."release_artifact_pin" USING btree ("release_id","artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "software_api_system_slug_unique" ON "software"."api" USING btree ("system_id","slug");--> statement-breakpoint
CREATE INDEX "software_system_slug_idx" ON "software"."system" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "software_system_name_idx" ON "software"."system" USING btree ("name");--> statement-breakpoint
CREATE INDEX "software_system_owner_team_idx" ON "software"."system" USING btree ("owner_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "software_template_slug_unique" ON "software"."template" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "software_template_name_unique" ON "software"."template" USING btree ("name");--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════
-- Hand-edited additions (not expressible in Drizzle schema DSL)
-- ═══════════════════════════════════════════════════════════════════

-- ── Extension: btree_gist (required for EXCLUDE constraints) ─────
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- ── Cross-schema FK constraints (infra → ops, circular dep) ──────
-- These cannot be expressed in Drizzle due to circular import between
-- infra and ops schemas. Infra owns networking primitives (route, dns),
-- ops owns deployment intent (site, system_deployment).
ALTER TABLE "infra"."route"
  ADD CONSTRAINT "route_site_id_fk"
  FOREIGN KEY ("site_id") REFERENCES "ops"."site"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "infra"."route"
  ADD CONSTRAINT "route_system_deployment_id_fk"
  FOREIGN KEY ("system_deployment_id") REFERENCES "ops"."system_deployment"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "infra"."dns_domain"
  ADD CONSTRAINT "dns_domain_site_id_fk"
  FOREIGN KEY ("site_id") REFERENCES "ops"."site"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint

-- ── EXCLUDE constraints (prevent overlapping valid_time per entity) ──
-- Pattern: no two rows with the same id can have overlapping valid_time ranges.
-- Uses GiST index on (id, tstzrange(valid_from, COALESCE(valid_to, 'infinity'))).

ALTER TABLE "software"."system"
  ADD CONSTRAINT "system_no_overlap"
  EXCLUDE USING gist (
    id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
  );--> statement-breakpoint

ALTER TABLE "software"."component"
  ADD CONSTRAINT "component_no_overlap"
  EXCLUDE USING gist (
    id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
  );--> statement-breakpoint

ALTER TABLE "org"."team"
  ADD CONSTRAINT "team_no_overlap"
  EXCLUDE USING gist (
    id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
  );--> statement-breakpoint

ALTER TABLE "org"."principal"
  ADD CONSTRAINT "principal_no_overlap"
  EXCLUDE USING gist (
    id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
  );--> statement-breakpoint

ALTER TABLE "build"."repo"
  ADD CONSTRAINT "repo_no_overlap"
  EXCLUDE USING gist (
    id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
  );--> statement-breakpoint

ALTER TABLE "commerce"."customer"
  ADD CONSTRAINT "customer_no_overlap"
  EXCLUDE USING gist (
    id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
  );--> statement-breakpoint

ALTER TABLE "commerce"."subscription"
  ADD CONSTRAINT "subscription_no_overlap"
  EXCLUDE USING gist (
    id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
  );--> statement-breakpoint

ALTER TABLE "ops"."site"
  ADD CONSTRAINT "site_no_overlap"
  EXCLUDE USING gist (
    id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
  );--> statement-breakpoint

ALTER TABLE "ops"."system_deployment"
  ADD CONSTRAINT "system_deployment_no_overlap"
  EXCLUDE USING gist (
    id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
  );--> statement-breakpoint

ALTER TABLE "ops"."workspace"
  ADD CONSTRAINT "workspace_no_overlap"
  EXCLUDE USING gist (
    id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
  );--> statement-breakpoint

-- ── Partial unique indexes (uniqueness only on current live rows) ──
-- Replaces full UNIQUE indexes on bitemporal tables. Multiple historical
-- rows can share the same slug; only the live row must be unique.

CREATE UNIQUE INDEX "software_system_slug_current_unique"
  ON "software"."system" ("slug")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "software_system_name_current_unique"
  ON "software"."system" ("name")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "software_component_system_slug_current_unique"
  ON "software"."component" ("system_id", "slug")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "software_component_system_name_current_unique"
  ON "software"."component" ("system_id", "name")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "org_team_slug_current_unique"
  ON "org"."team" ("slug")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "org_team_name_current_unique"
  ON "org"."team" ("name")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "org_principal_slug_current_unique"
  ON "org"."principal" ("slug")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "build_repo_slug_current_unique"
  ON "build"."repo" ("slug")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "commerce_customer_slug_current_unique"
  ON "commerce"."customer" ("slug")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "commerce_customer_name_current_unique"
  ON "commerce"."customer" ("name")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "ops_site_slug_current_unique"
  ON "ops"."site" ("slug")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "ops_site_name_current_unique"
  ON "ops"."site" ("name")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "ops_system_deployment_site_slug_current_unique"
  ON "ops"."system_deployment" ("site_id", "slug")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "ops_workspace_slug_current_unique"
  ON "ops"."workspace" ("slug")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

-- ── GiST indexes for temporal range queries ──────────────────────
-- Speeds up asOf() and validAt() queries on bitemporal tables.

CREATE INDEX "software_system_valid_range_gist"
  ON "software"."system" USING gist (tstzrange(valid_from, COALESCE(valid_to, 'infinity')));--> statement-breakpoint

CREATE INDEX "software_component_valid_range_gist"
  ON "software"."component" USING gist (tstzrange(valid_from, COALESCE(valid_to, 'infinity')));--> statement-breakpoint

CREATE INDEX "org_team_valid_range_gist"
  ON "org"."team" USING gist (tstzrange(valid_from, COALESCE(valid_to, 'infinity')));--> statement-breakpoint

CREATE INDEX "org_principal_valid_range_gist"
  ON "org"."principal" USING gist (tstzrange(valid_from, COALESCE(valid_to, 'infinity')));--> statement-breakpoint

CREATE INDEX "build_repo_valid_range_gist"
  ON "build"."repo" USING gist (tstzrange(valid_from, COALESCE(valid_to, 'infinity')));--> statement-breakpoint

CREATE INDEX "commerce_customer_valid_range_gist"
  ON "commerce"."customer" USING gist (tstzrange(valid_from, COALESCE(valid_to, 'infinity')));--> statement-breakpoint

CREATE INDEX "commerce_subscription_valid_range_gist"
  ON "commerce"."subscription" USING gist (tstzrange(valid_from, COALESCE(valid_to, 'infinity')));--> statement-breakpoint

CREATE INDEX "ops_site_valid_range_gist"
  ON "ops"."site" USING gist (tstzrange(valid_from, COALESCE(valid_to, 'infinity')));--> statement-breakpoint

CREATE INDEX "ops_system_deployment_valid_range_gist"
  ON "ops"."system_deployment" USING gist (tstzrange(valid_from, COALESCE(valid_to, 'infinity')));--> statement-breakpoint

CREATE INDEX "ops_workspace_valid_range_gist"
  ON "ops"."workspace" USING gist (tstzrange(valid_from, COALESCE(valid_to, 'infinity')));--> statement-breakpoint

-- ── Current-row partial indexes (speeds up currentRow() filter) ──
-- Most queries filter WHERE valid_to IS NULL AND system_to IS NULL.
-- A partial btree index on (id) for current rows makes this fast.

CREATE INDEX "software_system_current_idx"
  ON "software"."system" ("id")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE INDEX "software_component_current_idx"
  ON "software"."component" ("id")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE INDEX "org_team_current_idx"
  ON "org"."team" ("id")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE INDEX "org_principal_current_idx"
  ON "org"."principal" ("id")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE INDEX "build_repo_current_idx"
  ON "build"."repo" ("id")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE INDEX "commerce_customer_current_idx"
  ON "commerce"."customer" ("id")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE INDEX "commerce_subscription_current_idx"
  ON "commerce"."subscription" ("id")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE INDEX "ops_site_current_idx"
  ON "ops"."site" ("id")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE INDEX "ops_system_deployment_current_idx"
  ON "ops"."system_deployment" ("id")
  WHERE valid_to IS NULL AND system_to IS NULL;--> statement-breakpoint

CREATE INDEX "ops_workspace_current_idx"
  ON "ops"."workspace" ("id")
  WHERE valid_to IS NULL AND system_to IS NULL;