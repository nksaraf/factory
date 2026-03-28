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
ALTER TABLE "factory_org"."channel_mapping" ADD CONSTRAINT "channel_mapping_messaging_provider_id_messaging_provider_messaging_provider_id_fk" FOREIGN KEY ("messaging_provider_id") REFERENCES "factory_org"."messaging_provider"("messaging_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."message_thread" ADD CONSTRAINT "message_thread_messaging_provider_id_messaging_provider_messaging_provider_id_fk" FOREIGN KEY ("messaging_provider_id") REFERENCES "factory_org"."messaging_provider"("messaging_provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."message_thread" ADD CONSTRAINT "message_thread_initiator_principal_id_principal_principal_id_fk" FOREIGN KEY ("initiator_principal_id") REFERENCES "factory_org"."principal"("principal_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_org"."messaging_provider" ADD CONSTRAINT "messaging_provider_team_id_team_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "factory_org"."team"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_workbench_type_idx" ON "factory_fleet"."workbench" USING btree ("type");--> statement-breakpoint
CREATE INDEX "fleet_workbench_principal_idx" ON "factory_fleet"."workbench" USING btree ("principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_channel_mapping_provider_channel_unique" ON "factory_org"."channel_mapping" USING btree ("messaging_provider_id","external_channel_id");--> statement-breakpoint
CREATE INDEX "org_channel_mapping_entity_idx" ON "factory_org"."channel_mapping" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_message_thread_provider_thread_unique" ON "factory_org"."message_thread" USING btree ("messaging_provider_id","external_thread_id");--> statement-breakpoint
CREATE INDEX "org_message_thread_channel_idx" ON "factory_org"."message_thread" USING btree ("messaging_provider_id","external_channel_id");--> statement-breakpoint
CREATE INDEX "org_message_thread_initiator_idx" ON "factory_org"."message_thread" USING btree ("initiator_principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_messaging_provider_slug_unique" ON "factory_org"."messaging_provider" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "org_messaging_provider_team_idx" ON "factory_org"."messaging_provider" USING btree ("team_id");