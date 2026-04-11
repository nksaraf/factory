CREATE TABLE "infra"."realm_host" (
	"realm_id" text NOT NULL,
	"host_id" text NOT NULL,
	"role" text DEFAULT 'single' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infra"."service" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"estate_id" text,
	"realm_id" text,
	"system_deployment_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" jsonb DEFAULT '{}' NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "infra"."substrate" RENAME TO "estate";--> statement-breakpoint
ALTER TABLE "infra"."runtime" RENAME TO "realm";--> statement-breakpoint
ALTER TABLE "infra"."host" RENAME COLUMN "substrate_id" TO "estate_id";--> statement-breakpoint
ALTER TABLE "infra"."route" RENAME COLUMN "runtime_id" TO "realm_id";--> statement-breakpoint
ALTER TABLE "infra"."realm" RENAME COLUMN "parent_runtime_id" TO "parent_realm_id";--> statement-breakpoint
ALTER TABLE "infra"."realm" RENAME COLUMN "host_id" TO "estate_id";--> statement-breakpoint
ALTER TABLE "infra"."estate" RENAME COLUMN "parent_substrate_id" TO "parent_estate_id";--> statement-breakpoint
ALTER TABLE "ops"."deployment_set" RENAME COLUMN "runtime_id" TO "realm_id";--> statement-breakpoint
ALTER TABLE "ops"."system_deployment" RENAME COLUMN "runtime_id" TO "realm_id";--> statement-breakpoint
ALTER TABLE "ops"."workspace" RENAME COLUMN "runtime_id" TO "realm_id";--> statement-breakpoint
ALTER TABLE "infra"."dns_domain" DROP CONSTRAINT "infra_dns_domain_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."host" DROP CONSTRAINT "infra_host_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."network_link" DROP CONSTRAINT "infra_network_link_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."network_link" DROP CONSTRAINT "infra_network_link_endpoint_kind_valid";--> statement-breakpoint
ALTER TABLE "infra"."route" DROP CONSTRAINT "infra_route_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."realm" DROP CONSTRAINT "infra_runtime_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."estate" DROP CONSTRAINT "infra_substrate_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."tunnel" DROP CONSTRAINT "infra_tunnel_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."tunnel" DROP CONSTRAINT "infra_tunnel_phase_valid";--> statement-breakpoint
ALTER TABLE "ops"."database_operation" DROP CONSTRAINT "database_operation_type_valid";--> statement-breakpoint
ALTER TABLE "ops"."forwarded_port" DROP CONSTRAINT "forwarded_port_type_valid";--> statement-breakpoint
ALTER TABLE "ops"."intervention" DROP CONSTRAINT "intervention_type_valid";--> statement-breakpoint
ALTER TABLE "ops"."operation_run" DROP CONSTRAINT "opr_trigger_valid";--> statement-breakpoint
ALTER TABLE "ops"."operation_run" DROP CONSTRAINT "opr_status_valid";--> statement-breakpoint
ALTER TABLE "ops"."preview" DROP CONSTRAINT "ops_preview_phase_valid";--> statement-breakpoint
ALTER TABLE "ops"."system_deployment" DROP CONSTRAINT "system_deployment_type_valid";--> statement-breakpoint
ALTER TABLE "ops"."workbench" DROP CONSTRAINT "workbench_type_valid";--> statement-breakpoint
ALTER TABLE "ops"."workspace" DROP CONSTRAINT "workspace_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."host" DROP CONSTRAINT "host_substrate_id_substrate_id_fk";
--> statement-breakpoint
ALTER TABLE "infra"."ip_address" DROP CONSTRAINT "ip_address_subnet_id_substrate_id_fk";
--> statement-breakpoint
ALTER TABLE "infra"."route" DROP CONSTRAINT "route_runtime_id_runtime_id_fk";
--> statement-breakpoint
ALTER TABLE "infra"."realm" DROP CONSTRAINT "runtime_parent_runtime_id_runtime_id_fk";
--> statement-breakpoint
ALTER TABLE "infra"."realm" DROP CONSTRAINT "runtime_host_id_host_id_fk";
--> statement-breakpoint
ALTER TABLE "infra"."estate" DROP CONSTRAINT "substrate_parent_substrate_id_substrate_id_fk";
--> statement-breakpoint
ALTER TABLE "ops"."deployment_set" DROP CONSTRAINT "deployment_set_runtime_id_runtime_id_fk";
--> statement-breakpoint
ALTER TABLE "ops"."system_deployment" DROP CONSTRAINT "system_deployment_runtime_id_runtime_id_fk";
--> statement-breakpoint
ALTER TABLE "ops"."workspace" DROP CONSTRAINT "workspace_runtime_id_runtime_id_fk";
--> statement-breakpoint
DROP INDEX "infra"."infra_host_substrate_idx";--> statement-breakpoint
DROP INDEX "infra"."infra_route_runtime_idx";--> statement-breakpoint
DROP INDEX "infra"."infra_runtime_slug_unique";--> statement-breakpoint
DROP INDEX "infra"."infra_runtime_type_idx";--> statement-breakpoint
DROP INDEX "infra"."infra_runtime_parent_idx";--> statement-breakpoint
DROP INDEX "infra"."infra_runtime_host_idx";--> statement-breakpoint
DROP INDEX "infra"."infra_substrate_slug_unique";--> statement-breakpoint
DROP INDEX "infra"."infra_substrate_type_idx";--> statement-breakpoint
DROP INDEX "infra"."infra_substrate_parent_idx";--> statement-breakpoint
DROP INDEX "ops"."ops_deployment_set_runtime_idx";--> statement-breakpoint
DROP INDEX "ops"."ops_system_deployment_runtime_idx";--> statement-breakpoint
DROP INDEX "ops"."ops_workspace_runtime_idx";--> statement-breakpoint
ALTER TABLE "infra"."realm" ADD COLUMN "workbench_id" text;--> statement-breakpoint
ALTER TABLE "infra"."realm_host" ADD CONSTRAINT "realm_host_realm_id_realm_id_fk" FOREIGN KEY ("realm_id") REFERENCES "infra"."realm"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."realm_host" ADD CONSTRAINT "realm_host_host_id_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "infra"."host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."service" ADD CONSTRAINT "service_estate_id_estate_id_fk" FOREIGN KEY ("estate_id") REFERENCES "infra"."estate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."service" ADD CONSTRAINT "service_realm_id_realm_id_fk" FOREIGN KEY ("realm_id") REFERENCES "infra"."realm"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "infra_realm_host_unique" ON "infra"."realm_host" USING btree ("realm_id","host_id");--> statement-breakpoint
CREATE INDEX "infra_realm_host_realm_idx" ON "infra"."realm_host" USING btree ("realm_id");--> statement-breakpoint
CREATE INDEX "infra_realm_host_host_idx" ON "infra"."realm_host" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_service_slug_unique" ON "infra"."service" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "infra_service_type_idx" ON "infra"."service" USING btree ("type");--> statement-breakpoint
CREATE INDEX "infra_service_estate_idx" ON "infra"."service" USING btree ("estate_id");--> statement-breakpoint
CREATE INDEX "infra_service_realm_idx" ON "infra"."service" USING btree ("realm_id");--> statement-breakpoint
CREATE INDEX "infra_service_sd_idx" ON "infra"."service" USING btree ("system_deployment_id");--> statement-breakpoint
ALTER TABLE "infra"."host" ADD CONSTRAINT "host_estate_id_estate_id_fk" FOREIGN KEY ("estate_id") REFERENCES "infra"."estate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."ip_address" ADD CONSTRAINT "ip_address_subnet_id_estate_id_fk" FOREIGN KEY ("subnet_id") REFERENCES "infra"."estate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."route" ADD CONSTRAINT "route_realm_id_realm_id_fk" FOREIGN KEY ("realm_id") REFERENCES "infra"."realm"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."realm" ADD CONSTRAINT "realm_parent_realm_id_realm_id_fk" FOREIGN KEY ("parent_realm_id") REFERENCES "infra"."realm"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."realm" ADD CONSTRAINT "realm_estate_id_estate_id_fk" FOREIGN KEY ("estate_id") REFERENCES "infra"."estate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infra"."estate" ADD CONSTRAINT "estate_parent_estate_id_estate_id_fk" FOREIGN KEY ("parent_estate_id") REFERENCES "infra"."estate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."deployment_set" ADD CONSTRAINT "deployment_set_realm_id_realm_id_fk" FOREIGN KEY ("realm_id") REFERENCES "infra"."realm"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."system_deployment" ADD CONSTRAINT "system_deployment_realm_id_realm_id_fk" FOREIGN KEY ("realm_id") REFERENCES "infra"."realm"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."workspace" ADD CONSTRAINT "workspace_realm_id_realm_id_fk" FOREIGN KEY ("realm_id") REFERENCES "infra"."realm"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "infra_host_estate_idx" ON "infra"."host" USING btree ("estate_id");--> statement-breakpoint
CREATE INDEX "infra_route_realm_idx" ON "infra"."route" USING btree ("realm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_realm_slug_unique" ON "infra"."realm" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "infra_realm_type_idx" ON "infra"."realm" USING btree ("type");--> statement-breakpoint
CREATE INDEX "infra_realm_parent_idx" ON "infra"."realm" USING btree ("parent_realm_id");--> statement-breakpoint
CREATE INDEX "infra_realm_estate_idx" ON "infra"."realm" USING btree ("estate_id");--> statement-breakpoint
CREATE INDEX "infra_realm_workbench_idx" ON "infra"."realm" USING btree ("workbench_id");--> statement-breakpoint
CREATE UNIQUE INDEX "infra_estate_slug_unique" ON "infra"."estate" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "infra_estate_type_idx" ON "infra"."estate" USING btree ("type");--> statement-breakpoint
CREATE INDEX "infra_estate_parent_idx" ON "infra"."estate" USING btree ("parent_estate_id");--> statement-breakpoint
CREATE INDEX "ops_deployment_set_realm_idx" ON "ops"."deployment_set" USING btree ("realm_id");--> statement-breakpoint
CREATE INDEX "ops_system_deployment_realm_idx" ON "ops"."system_deployment" USING btree ("realm_id");--> statement-breakpoint
CREATE INDEX "ops_workspace_realm_idx" ON "ops"."workspace" USING btree ("realm_id");