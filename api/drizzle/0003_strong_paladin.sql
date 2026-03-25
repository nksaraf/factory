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
CREATE TABLE "factory_fleet"."sandbox_snapshot" (
	"snapshot_id" text PRIMARY KEY NOT NULL,
	"deployment_target_id" text NOT NULL,
	"workload_config" jsonb NOT NULL,
	"dependency_config" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "factory_commerce"."entitlement" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "factory_commerce"."entitlement" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "factory_fleet"."site" ADD COLUMN "last_checkin_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "factory_fleet"."site" ADD COLUMN "current_manifest_version" integer;--> statement-breakpoint
ALTER TABLE "factory_commerce"."entitlement_bundle" ADD CONSTRAINT "entitlement_bundle_customer_id_customer_account_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "factory_commerce"."customer_account"("customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."sandbox_snapshot" ADD CONSTRAINT "sandbox_snapshot_deployment_target_id_deployment_target_deployment_target_id_fk" FOREIGN KEY ("deployment_target_id") REFERENCES "factory_fleet"."deployment_target"("deployment_target_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."site_manifest" ADD CONSTRAINT "site_manifest_site_id_site_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "factory_fleet"."site"("site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_fleet"."site_manifest" ADD CONSTRAINT "site_manifest_release_id_release_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "factory_fleet"."release"("release_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_manifest_site_version_unique" ON "factory_fleet"."site_manifest" USING btree ("site_id","manifest_version");--> statement-breakpoint
CREATE INDEX "site_manifest_site_latest_idx" ON "factory_fleet"."site_manifest" USING btree ("site_id","manifest_version");
