CREATE TABLE "org"."reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"exchange_id" text,
	"principal_id" text NOT NULL,
	"surface" text,
	"kind" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"site_id" text,
	"workbench_id" text,
	"sandbox_provider" text DEFAULT 'none' NOT NULL,
	"agent_host_kind" text DEFAULT 'site' NOT NULL,
	"agent_host_ref" text,
	"principal_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"agent_type" text,
	"process_info" jsonb,
	"cursor_message_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org"."message" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "org"."message" ADD COLUMN "superseded_by" text;--> statement-breakpoint
ALTER TABLE "org"."thread" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "org"."thread" ADD COLUMN "workbench_id" text;--> statement-breakpoint
ALTER TABLE "org"."thread" ADD COLUMN "fork_exchange_id" text;--> statement-breakpoint
ALTER TABLE "org"."thread_channel" ADD COLUMN "permissions" text[] DEFAULT '{observe}' NOT NULL;--> statement-breakpoint
ALTER TABLE "org"."tool_call" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "org"."tool_call" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org"."tool_call" ADD COLUMN "approval_surface" text;--> statement-breakpoint
ALTER TABLE "org"."reaction" ADD CONSTRAINT "reaction_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "org"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."reaction" ADD CONSTRAINT "reaction_exchange_id_exchange_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "org"."exchange"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."reaction" ADD CONSTRAINT "reaction_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "org"."principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."session" ADD CONSTRAINT "session_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "org"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."session" ADD CONSTRAINT "session_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "org"."principal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_reaction_message_idx" ON "org"."reaction" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "org_reaction_exchange_idx" ON "org"."reaction" USING btree ("exchange_id");--> statement-breakpoint
CREATE INDEX "org_reaction_principal_idx" ON "org"."reaction" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "org_reaction_kind_idx" ON "org"."reaction" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "org_reaction_message_kind_idx" ON "org"."reaction" USING btree ("message_id","kind");--> statement-breakpoint
CREATE INDEX "org_session_thread_idx" ON "org"."session" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "org_session_site_idx" ON "org"."session" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "org_session_workbench_idx" ON "org"."session" USING btree ("workbench_id");--> statement-breakpoint
CREATE INDEX "org_session_principal_idx" ON "org"."session" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "org_session_status_idx" ON "org"."session" USING btree ("status");--> statement-breakpoint
CREATE INDEX "org_session_mode_idx" ON "org"."session" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "org_session_agent_type_idx" ON "org"."session" USING btree ("agent_type");--> statement-breakpoint
CREATE INDEX "org_message_status_idx" ON "org"."message" USING btree ("status");--> statement-breakpoint
CREATE INDEX "org_thread_site_idx" ON "org"."thread" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "org_thread_workbench_idx" ON "org"."thread" USING btree ("workbench_id");