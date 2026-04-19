CREATE TABLE "org"."exchange" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"trigger_message_id" text NOT NULL,
	"terminal_message_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"parent_id" text,
	"role" text NOT NULL,
	"source" text NOT NULL,
	"content" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org"."tool_call" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"message_id" text NOT NULL,
	"exchange_id" text,
	"name" text NOT NULL,
	"input" jsonb,
	"result" jsonb,
	"result_message_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_error" boolean,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org"."document_version" ADD COLUMN "source_message_id" text;--> statement-breakpoint
ALTER TABLE "org"."document_version" ADD COLUMN "source_tool_call_id" text;--> statement-breakpoint
ALTER TABLE "org"."exchange" ADD CONSTRAINT "exchange_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "org"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."exchange" ADD CONSTRAINT "exchange_trigger_message_id_message_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "org"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."exchange" ADD CONSTRAINT "exchange_terminal_message_id_message_id_fk" FOREIGN KEY ("terminal_message_id") REFERENCES "org"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."message" ADD CONSTRAINT "message_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "org"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."tool_call" ADD CONSTRAINT "tool_call_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "org"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."tool_call" ADD CONSTRAINT "tool_call_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "org"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."tool_call" ADD CONSTRAINT "tool_call_exchange_id_exchange_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "org"."exchange"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."tool_call" ADD CONSTRAINT "tool_call_result_message_id_message_id_fk" FOREIGN KEY ("result_message_id") REFERENCES "org"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_exchange_thread_idx" ON "org"."exchange" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "org_exchange_thread_started_idx" ON "org"."exchange" USING btree ("thread_id","started_at");--> statement-breakpoint
CREATE INDEX "org_exchange_status_idx" ON "org"."exchange" USING btree ("status");--> statement-breakpoint
CREATE INDEX "org_exchange_trigger_idx" ON "org"."exchange" USING btree ("trigger_message_id");--> statement-breakpoint
CREATE INDEX "org_exchange_spec_gin_idx" ON "org"."exchange" USING gin ("spec");--> statement-breakpoint
CREATE INDEX "org_message_thread_idx" ON "org"."message" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "org_message_thread_started_idx" ON "org"."message" USING btree ("thread_id","started_at");--> statement-breakpoint
CREATE INDEX "org_message_parent_idx" ON "org"."message" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "org_message_role_idx" ON "org"."message" USING btree ("role");--> statement-breakpoint
CREATE INDEX "org_message_source_idx" ON "org"."message" USING btree ("source");--> statement-breakpoint
CREATE INDEX "org_message_spec_gin_idx" ON "org"."message" USING gin ("spec");--> statement-breakpoint
CREATE INDEX "org_message_content_gin_idx" ON "org"."message" USING gin ("content");--> statement-breakpoint
CREATE INDEX "org_tool_call_thread_idx" ON "org"."tool_call" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "org_tool_call_message_idx" ON "org"."tool_call" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "org_tool_call_exchange_idx" ON "org"."tool_call" USING btree ("exchange_id");--> statement-breakpoint
CREATE INDEX "org_tool_call_name_idx" ON "org"."tool_call" USING btree ("name");--> statement-breakpoint
CREATE INDEX "org_tool_call_name_thread_idx" ON "org"."tool_call" USING btree ("name","thread_id");--> statement-breakpoint
CREATE INDEX "org_tool_call_status_idx" ON "org"."tool_call" USING btree ("status");--> statement-breakpoint
CREATE INDEX "org_tool_call_result_msg_idx" ON "org"."tool_call" USING btree ("result_message_id");--> statement-breakpoint
CREATE INDEX "org_tool_call_input_gin_idx" ON "org"."tool_call" USING gin ("input");--> statement-breakpoint
CREATE INDEX "org_tool_call_spec_gin_idx" ON "org"."tool_call" USING gin ("spec");--> statement-breakpoint
ALTER TABLE "org"."document_version" ADD CONSTRAINT "document_version_source_message_id_message_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "org"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."document_version" ADD CONSTRAINT "document_version_source_tool_call_id_tool_call_id_fk" FOREIGN KEY ("source_tool_call_id") REFERENCES "org"."tool_call"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_docver_source_message_idx" ON "org"."document_version" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "org_docver_source_tool_call_idx" ON "org"."document_version" USING btree ("source_tool_call_id");