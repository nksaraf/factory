CREATE TABLE "org"."thread_channel" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_thread_channel_role_valid" CHECK ("org"."thread_channel"."role" IN ('mirror', 'subscriber', 'active')),
	CONSTRAINT "org_thread_channel_status_valid" CHECK ("org"."thread_channel"."status" IN ('connected', 'detached', 'paused'))
);
--> statement-breakpoint
ALTER TABLE "org"."thread_channel" ADD CONSTRAINT "thread_channel_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "org"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."thread_channel" ADD CONSTRAINT "thread_channel_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "org"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_thread_channel_unique" ON "org"."thread_channel" USING btree ("thread_id","channel_id");--> statement-breakpoint
CREATE INDEX "org_thread_channel_thread_idx" ON "org"."thread_channel" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "org_thread_channel_channel_idx" ON "org"."thread_channel" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "org_thread_channel_status_idx" ON "org"."thread_channel" USING btree ("status");