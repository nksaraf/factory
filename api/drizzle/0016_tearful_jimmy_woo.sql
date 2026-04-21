CREATE TABLE "org"."idempotency_key" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"user_id" text DEFAULT 'anonymous' NOT NULL,
	"request_method" text NOT NULL,
	"request_path" text NOT NULL,
	"request_body" jsonb DEFAULT '{}' NOT NULL,
	"response_code" integer,
	"response_body" jsonb,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_idempotency_key_user_key" ON "org"."idempotency_key" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "org_idempotency_key_expires_idx" ON "org"."idempotency_key" USING btree ("expires_at");