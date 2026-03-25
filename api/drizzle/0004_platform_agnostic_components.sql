-- 0004_platform_agnostic_components.sql
-- Platform-agnostic component model: new component kinds, runtime on deployment targets,
-- osType on hosts/VMs, artifact kinds

-- 1. Component kind: deployment→server, statefulset→server+stateful, job→task, cronjob→scheduled
--    Add new kinds first, then migrate data, then drop old constraint

-- Add stateful column to component_spec
ALTER TABLE factory_product.component_spec ADD COLUMN "stateful" boolean NOT NULL DEFAULT false;--> statement-breakpoint
UPDATE factory_product.component_spec SET "stateful" = true WHERE kind = 'statefulset';--> statement-breakpoint
UPDATE factory_product.component_spec SET kind = 'server' WHERE kind IN ('deployment', 'statefulset');--> statement-breakpoint
UPDATE factory_product.component_spec SET kind = 'task' WHERE kind = 'job';--> statement-breakpoint
UPDATE factory_product.component_spec SET kind = 'scheduled' WHERE kind = 'cronjob';--> statement-breakpoint
ALTER TABLE factory_product.component_spec DROP CONSTRAINT "component_spec_kind_valid";--> statement-breakpoint
ALTER TABLE factory_product.component_spec ADD CONSTRAINT "component_spec_kind_valid"
  CHECK (kind IN ('server', 'worker', 'task', 'scheduled', 'site', 'database', 'gateway'));--> statement-breakpoint

-- Component ports: replace single port integer with ports JSONB array
ALTER TABLE factory_product.component_spec ADD COLUMN "ports" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
UPDATE factory_product.component_spec
  SET ports = jsonb_build_array(jsonb_build_object('name', 'default', 'port', port, 'protocol', 'http'))
  WHERE port IS NOT NULL;--> statement-breakpoint
ALTER TABLE factory_product.component_spec DROP COLUMN "port";--> statement-breakpoint

-- Healthcheck JSONB column
ALTER TABLE factory_product.component_spec ADD COLUMN "healthcheck" jsonb;--> statement-breakpoint
UPDATE factory_product.component_spec
  SET healthcheck = jsonb_build_object('path', healthcheck_path, 'portName', 'default', 'protocol', 'http')
  WHERE healthcheck_path IS NOT NULL;--> statement-breakpoint
ALTER TABLE factory_product.component_spec DROP COLUMN "healthcheck_path";--> statement-breakpoint

-- 2. Deployment target: add runtime, hostId, vmId
ALTER TABLE factory_fleet.deployment_target ADD COLUMN "runtime" text NOT NULL DEFAULT 'kubernetes';--> statement-breakpoint
ALTER TABLE factory_fleet.deployment_target ADD COLUMN "host_id" text REFERENCES factory_infra.host(host_id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE factory_fleet.deployment_target ADD COLUMN "vm_id" text REFERENCES factory_infra.vm(vm_id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE factory_fleet.deployment_target ADD CONSTRAINT "deployment_target_runtime_valid"
  CHECK (runtime IN ('kubernetes', 'compose', 'systemd', 'windows_service', 'iis', 'process'));--> statement-breakpoint

-- 3. Workload: add desired_artifact_uri for non-container artifacts
ALTER TABLE factory_fleet.workload ADD COLUMN "desired_artifact_uri" text;--> statement-breakpoint

-- 4. Artifact: add kind field
ALTER TABLE factory_build.artifact ADD COLUMN "kind" text NOT NULL DEFAULT 'container_image';--> statement-breakpoint
ALTER TABLE factory_build.artifact ADD CONSTRAINT "artifact_kind_valid"
  CHECK (kind IN ('container_image', 'binary', 'archive', 'package', 'bundle'));--> statement-breakpoint

-- 5. Host: add osType, accessMethod
ALTER TABLE factory_infra.host ADD COLUMN "os_type" text NOT NULL DEFAULT 'linux';--> statement-breakpoint
ALTER TABLE factory_infra.host ADD COLUMN "access_method" text NOT NULL DEFAULT 'ssh';--> statement-breakpoint
ALTER TABLE factory_infra.host ADD CONSTRAINT "host_os_type_valid"
  CHECK (os_type IN ('linux', 'windows'));--> statement-breakpoint
ALTER TABLE factory_infra.host ADD CONSTRAINT "host_access_method_valid"
  CHECK (access_method IN ('ssh', 'winrm', 'rdp'));--> statement-breakpoint

-- 6. VM: add osType, accessMethod, replace sshUser with accessUser, drop sshUser
ALTER TABLE factory_infra.vm ADD COLUMN "os_type" text NOT NULL DEFAULT 'linux';--> statement-breakpoint
ALTER TABLE factory_infra.vm ADD COLUMN "access_method" text NOT NULL DEFAULT 'ssh';--> statement-breakpoint
ALTER TABLE factory_infra.vm ADD COLUMN "access_user" text;--> statement-breakpoint
UPDATE factory_infra.vm SET access_user = ssh_user WHERE ssh_user IS NOT NULL;--> statement-breakpoint
ALTER TABLE factory_infra.vm DROP COLUMN "ssh_user";--> statement-breakpoint
ALTER TABLE factory_infra.vm ADD CONSTRAINT "vm_os_type_valid"
  CHECK (os_type IN ('linux', 'windows'));--> statement-breakpoint
ALTER TABLE factory_infra.vm ADD CONSTRAINT "vm_access_method_valid"
  CHECK (access_method IN ('ssh', 'winrm', 'rdp'));--> statement-breakpoint

-- 7. Add missing sandbox_template, sandbox, and sandbox_access tables
--    (these were added to the schema in a prior commit but migration was omitted)
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
	"pre_installed_tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"description" text,
	"is_default" boolean NOT NULL DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_template_runtime_valid" CHECK (runtime_type IN ('container', 'vm'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_template_slug_unique" ON "factory_fleet"."sandbox_template" USING btree ("slug");--> statement-breakpoint
CREATE TABLE "factory_fleet"."sandbox" (
	"sandbox_id" text PRIMARY KEY NOT NULL,
	"deployment_target_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"runtime_type" text NOT NULL,
	"vm_id" text,
	"pod_name" text,
	"devcontainer_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"devcontainer_image" text,
	"owner_id" text NOT NULL,
	"owner_type" text NOT NULL,
	"setup_progress" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"status_message" text,
	"repos" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"docker_cache_gb" integer NOT NULL DEFAULT 20,
	"cpu" text,
	"memory" text,
	"storage_gb" integer NOT NULL DEFAULT 10,
	"ssh_host" text,
	"ssh_port" integer,
	"web_terminal_url" text,
	"cloned_from_snapshot_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_runtime_type_valid" CHECK (runtime_type IN ('container', 'vm')),
	CONSTRAINT "sandbox_owner_type_valid" CHECK (owner_type IN ('user', 'agent'))
);--> statement-breakpoint
ALTER TABLE "factory_fleet"."sandbox" ADD CONSTRAINT "sandbox_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_deployment_target_unique" ON "factory_fleet"."sandbox" USING btree ("deployment_target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_slug_unique" ON "factory_fleet"."sandbox" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sandbox_owner_idx" ON "factory_fleet"."sandbox" USING btree ("owner_type", "owner_id");--> statement-breakpoint
CREATE TABLE "factory_fleet"."sandbox_access" (
	"sandbox_access_id" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"role" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_access_role_valid" CHECK (role IN ('owner', 'editor', 'viewer')),
	CONSTRAINT "sandbox_access_principal_type_valid" CHECK (principal_type IN ('user', 'agent'))
);--> statement-breakpoint
ALTER TABLE "factory_fleet"."sandbox_access" ADD CONSTRAINT "sandbox_access_sandbox_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "factory_fleet"."sandbox"("sandbox_id") ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_access_unique" ON "factory_fleet"."sandbox_access" USING btree ("sandbox_id", "principal_id");--> statement-breakpoint
CREATE INDEX "sandbox_access_principal_idx" ON "factory_fleet"."sandbox_access" USING btree ("principal_type", "principal_id");
