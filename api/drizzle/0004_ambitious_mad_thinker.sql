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
ALTER TABLE "factory_infra"."provider" DROP CONSTRAINT "provider_type_valid";--> statement-breakpoint
ALTER TABLE "factory_infra"."provider" DROP CONSTRAINT "provider_status_valid";--> statement-breakpoint
ALTER TABLE "factory_infra"."provider" DROP CONSTRAINT "provider_kind_valid";--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD COLUMN "role_preset_slug" text;--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD COLUMN "autonomy_level" text DEFAULT 'executor' NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD COLUMN "relationship" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD COLUMN "relationship_entity_id" text;--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD COLUMN "collaboration_mode" text DEFAULT 'solo' NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD COLUMN "reports_to_agent_id" text;--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD COLUMN "trust_score" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD COLUMN "guardrails" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_agent"."job" ADD CONSTRAINT "job_agent_id_agent_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "factory_agent"."agent"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_agent"."job" ADD CONSTRAINT "job_message_thread_id_message_thread_message_thread_id_fk" FOREIGN KEY ("message_thread_id") REFERENCES "factory_org"."message_thread"("message_thread_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_agent"."job" ADD CONSTRAINT "job_delegated_by_agent_id_agent_agent_id_fk" FOREIGN KEY ("delegated_by_agent_id") REFERENCES "factory_agent"."agent"("agent_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."memory" ADD CONSTRAINT "memory_approved_by_principal_id_principal_principal_id_fk" FOREIGN KEY ("approved_by_principal_id") REFERENCES "factory_org"."principal"("principal_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."secret" ADD CONSTRAINT "secret_created_by_principal_principal_id_fk" FOREIGN KEY ("created_by") REFERENCES "factory_org"."principal"("principal_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_agent_idx" ON "factory_agent"."job" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "job_status_idx" ON "factory_agent"."job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_entity_idx" ON "factory_agent"."job" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "job_parent_idx" ON "factory_agent"."job" USING btree ("parent_job_id");--> statement-breakpoint
CREATE INDEX "job_message_thread_idx" ON "factory_agent"."job" USING btree ("message_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_preset_slug_unique" ON "factory_agent"."role_preset" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "role_preset_org_idx" ON "factory_agent"."role_preset" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_key_fingerprint_unique" ON "factory_infra"."ssh_key" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_key_principal_name_unique" ON "factory_infra"."ssh_key" USING btree ("principal_id","name");--> statement-breakpoint
CREATE INDEX "ssh_key_principal_idx" ON "factory_infra"."ssh_key" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "memory_org_layer_idx" ON "factory_org"."memory" USING btree ("org_id","layer");--> statement-breakpoint
CREATE INDEX "memory_layer_entity_idx" ON "factory_org"."memory" USING btree ("layer","layer_entity_id");--> statement-breakpoint
CREATE INDEX "memory_status_idx" ON "factory_org"."memory" USING btree ("status");--> statement-breakpoint
CREATE INDEX "memory_source_job_idx" ON "factory_org"."memory" USING btree ("source_job_id");--> statement-breakpoint
CREATE INDEX "memory_source_agent_idx" ON "factory_org"."memory" USING btree ("source_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_secret_key_scope_env_unique" ON "factory_org"."secret" USING btree ("key","scope_type","scope_id","environment");--> statement-breakpoint
CREATE INDEX "org_secret_scope_idx" ON "factory_org"."secret" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "org_secret_environment_idx" ON "factory_org"."secret" USING btree ("environment");--> statement-breakpoint
CREATE INDEX "agent_preset_idx" ON "factory_agent"."agent" USING btree ("role_preset_slug");--> statement-breakpoint
CREATE INDEX "agent_relationship_idx" ON "factory_agent"."agent" USING btree ("relationship","relationship_entity_id");--> statement-breakpoint
CREATE INDEX "agent_reports_to_idx" ON "factory_agent"."agent" USING btree ("reports_to_agent_id");--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD CONSTRAINT "agent_autonomy_level_valid" CHECK ("factory_agent"."agent"."autonomy_level" IN ('observer', 'advisor', 'executor', 'operator', 'supervisor'));--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD CONSTRAINT "agent_relationship_valid" CHECK ("factory_agent"."agent"."relationship" IN ('personal', 'team', 'org'));--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ADD CONSTRAINT "agent_collaboration_mode_valid" CHECK ("factory_agent"."agent"."collaboration_mode" IN ('solo', 'pair', 'crew', 'hierarchy'));