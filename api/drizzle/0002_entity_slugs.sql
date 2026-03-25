-- Slug columns: add nullable, backfill from name (or display_name), dedupe, NOT NULL, then unique indexes.

-- factory_agent.agent
ALTER TABLE "factory_agent"."agent" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_agent"."agent" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_agent"."agent" SET "slug" = 'agt-' || substr(md5("agent_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "agent_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "agent_id") AS rn FROM "factory_agent"."agent") UPDATE "factory_agent"."agent" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."agent_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_agent"."agent" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_build.repo
ALTER TABLE "factory_build"."repo" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_build"."repo" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_build"."repo" SET "slug" = 'repo-' || substr(md5("repo_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "repo_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "repo_id") AS rn FROM "factory_build"."repo") UPDATE "factory_build"."repo" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."repo_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_build"."repo" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_commerce.plan
ALTER TABLE "factory_commerce"."plan" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_commerce"."plan" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_commerce"."plan" SET "slug" = 'pln-' || substr(md5("plan_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "plan_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "plan_id") AS rn FROM "factory_commerce"."plan") UPDATE "factory_commerce"."plan" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."plan_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_commerce"."plan" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_commerce.customer_account
ALTER TABLE "factory_commerce"."customer_account" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_commerce"."customer_account" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_commerce"."customer_account" SET "slug" = 'cust-' || substr(md5("customer_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "customer_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "customer_id") AS rn FROM "factory_commerce"."customer_account") UPDATE "factory_commerce"."customer_account" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."customer_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_commerce"."customer_account" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_fleet.dependency_workload (scoped by deployment_target_id)
ALTER TABLE "factory_fleet"."dependency_workload" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_fleet"."dependency_workload" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_fleet"."dependency_workload" SET "slug" = 'dwo-' || substr(md5("dependency_workload_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "dependency_workload_id" AS pk, row_number() OVER (PARTITION BY "deployment_target_id", "slug" ORDER BY "dependency_workload_id") AS rn FROM "factory_fleet"."dependency_workload") UPDATE "factory_fleet"."dependency_workload" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."dependency_workload_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_fleet"."dependency_workload" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_fleet.deployment_target
ALTER TABLE "factory_fleet"."deployment_target" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_fleet"."deployment_target" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_fleet"."deployment_target" SET "slug" = 'dt-' || substr(md5("deployment_target_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "deployment_target_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "deployment_target_id") AS rn FROM "factory_fleet"."deployment_target") UPDATE "factory_fleet"."deployment_target" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."deployment_target_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_fleet"."deployment_target" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_fleet.site
ALTER TABLE "factory_fleet"."site" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_fleet"."site" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_fleet"."site" SET "slug" = 'site-' || substr(md5("site_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "site_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "site_id") AS rn FROM "factory_fleet"."site") UPDATE "factory_fleet"."site" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."site_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_fleet"."site" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_infra.cluster
ALTER TABLE "factory_infra"."cluster" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_infra"."cluster" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_infra"."cluster" SET "slug" = 'cls-' || substr(md5("cluster_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "cluster_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "cluster_id") AS rn FROM "factory_infra"."cluster") UPDATE "factory_infra"."cluster" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."cluster_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_infra"."cluster" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_infra.datacenter (scoped by region_id; label from display_name then name)
ALTER TABLE "factory_infra"."datacenter" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_infra"."datacenter" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce(nullif(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("display_name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), ''), coalesce("name", '')), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_infra"."datacenter" SET "slug" = 'dc-' || substr(md5("datacenter_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "datacenter_id" AS pk, row_number() OVER (PARTITION BY "region_id", "slug" ORDER BY "datacenter_id") AS rn FROM "factory_infra"."datacenter") UPDATE "factory_infra"."datacenter" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."datacenter_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_infra"."datacenter" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_infra.host
ALTER TABLE "factory_infra"."host" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_infra"."host" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_infra"."host" SET "slug" = 'host-' || substr(md5("host_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "host_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "host_id") AS rn FROM "factory_infra"."host") UPDATE "factory_infra"."host" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."host_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_infra"."host" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_infra.kube_node (scoped by cluster_id)
ALTER TABLE "factory_infra"."kube_node" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_infra"."kube_node" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_infra"."kube_node" SET "slug" = 'kn-' || substr(md5("kube_node_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "kube_node_id" AS pk, row_number() OVER (PARTITION BY "cluster_id", "slug" ORDER BY "kube_node_id") AS rn FROM "factory_infra"."kube_node") UPDATE "factory_infra"."kube_node" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."kube_node_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_infra"."kube_node" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_infra.provider
ALTER TABLE "factory_infra"."provider" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_infra"."provider" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_infra"."provider" SET "slug" = 'prv-' || substr(md5("provider_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "provider_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "provider_id") AS rn FROM "factory_infra"."provider") UPDATE "factory_infra"."provider" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."provider_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_infra"."provider" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_infra.proxmox_cluster
ALTER TABLE "factory_infra"."proxmox_cluster" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_infra"."proxmox_cluster" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_infra"."proxmox_cluster" SET "slug" = 'pxc-' || substr(md5("proxmox_cluster_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "proxmox_cluster_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "proxmox_cluster_id") AS rn FROM "factory_infra"."proxmox_cluster") UPDATE "factory_infra"."proxmox_cluster" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."proxmox_cluster_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_infra"."proxmox_cluster" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_infra.vm
ALTER TABLE "factory_infra"."vm" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_infra"."vm" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_infra"."vm" SET "slug" = 'vm-' || substr(md5("vm_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "vm_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "vm_id") AS rn FROM "factory_infra"."vm") UPDATE "factory_infra"."vm" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."vm_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_product.component_spec (scoped by module_id)
ALTER TABLE "factory_product"."component_spec" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_product"."component_spec" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_product"."component_spec" SET "slug" = 'cmp-' || substr(md5("component_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "component_id" AS pk, row_number() OVER (PARTITION BY "module_id", "slug" ORDER BY "component_id") AS rn FROM "factory_product"."component_spec") UPDATE "factory_product"."component_spec" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."component_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_product"."component_spec" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- factory_product.module
ALTER TABLE "factory_product"."module" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "factory_product"."module" SET "slug" = left(trim(both '-' from regexp_replace(lower(regexp_replace(coalesce("name", ''), '[^a-zA-Z0-9]+', '-', 'g')), '-+', '-', 'g')), 80);--> statement-breakpoint
UPDATE "factory_product"."module" SET "slug" = 'mod-' || substr(md5("module_id"::text), 1, 12) WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
WITH "numbered" AS (SELECT "module_id" AS pk, row_number() OVER (PARTITION BY "slug" ORDER BY "module_id") AS rn FROM "factory_product"."module") UPDATE "factory_product"."module" "a" SET "slug" = "a"."slug" || '-' || "n"."rn"::text FROM "numbered" "n" WHERE "a"."module_id" = "n"."pk" AND "n"."rn" > 1;--> statement-breakpoint
ALTER TABLE "factory_product"."module" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "agent_slug_unique" ON "factory_agent"."agent" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_slug_unique" ON "factory_build"."repo" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_plan_slug_unique" ON "factory_commerce"."plan" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_account_slug_unique" ON "factory_commerce"."customer_account" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "dependency_workload_target_slug_unique" ON "factory_fleet"."dependency_workload" USING btree ("deployment_target_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_target_slug_unique" ON "factory_fleet"."deployment_target" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_site_slug_unique" ON "factory_fleet"."site" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_slug_unique" ON "factory_infra"."cluster" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "datacenter_region_slug_unique" ON "factory_infra"."datacenter" USING btree ("region_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "host_slug_unique" ON "factory_infra"."host" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "kube_node_cluster_slug_unique" ON "factory_infra"."kube_node" USING btree ("cluster_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_slug_unique" ON "factory_infra"."provider" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "proxmox_cluster_slug_unique" ON "factory_infra"."proxmox_cluster" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "vm_slug_unique" ON "factory_infra"."vm" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "component_spec_module_slug_unique" ON "factory_product"."component_spec" USING btree ("module_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "module_slug_unique" ON "factory_product"."module" USING btree ("slug");
