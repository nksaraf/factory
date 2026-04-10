CREATE TABLE "org"."document_version" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"version" integer NOT NULL,
	"content_path" text NOT NULL,
	"content_hash" text,
	"size_bytes" integer,
	"source" text,
	"thread_id" text,
	"spec" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "infra"."host" DROP CONSTRAINT "infra_host_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."network_link" DROP CONSTRAINT "infra_network_link_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."network_link" DROP CONSTRAINT "infra_network_link_endpoint_kind_valid";--> statement-breakpoint
ALTER TABLE "infra"."runtime" DROP CONSTRAINT "infra_runtime_type_valid";--> statement-breakpoint
ALTER TABLE "infra"."substrate" DROP CONSTRAINT "infra_substrate_type_valid";--> statement-breakpoint
ALTER TABLE "org"."document" DROP CONSTRAINT "document_parent_id_document_id_fk";
--> statement-breakpoint
DROP INDEX "org"."org_document_path_unique";--> statement-breakpoint
DROP INDEX "org"."org_document_parent_idx";--> statement-breakpoint
ALTER TABLE "org"."document" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "org"."document" ADD COLUMN "content_path" text;--> statement-breakpoint
ALTER TABLE "org"."document" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "org"."document_version" ADD CONSTRAINT "document_version_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "org"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."document_version" ADD CONSTRAINT "document_version_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "org"."thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_docver_doc_version_unique" ON "org"."document_version" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "org_docver_document_idx" ON "org"."document_version" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_document_slug_unique" ON "org"."document" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "org"."document" DROP COLUMN "path";--> statement-breakpoint
ALTER TABLE "org"."document" DROP COLUMN "version";--> statement-breakpoint
ALTER TABLE "org"."document" DROP COLUMN "parent_id";--> statement-breakpoint
ALTER TABLE "infra"."host" ADD CONSTRAINT "infra_host_type_valid" CHECK ("infra"."host"."type" IN ('bare-metal', 'vm', 'lxc', 'cloud-instance', 'network-appliance'));--> statement-breakpoint
ALTER TABLE "infra"."network_link" ADD CONSTRAINT "infra_network_link_type_valid" CHECK ("infra"."network_link"."type" IN ('proxy', 'direct', 'tunnel', 'nat', 'firewall', 'mesh', 'peering', 'dns-resolution', 'port-forward', 'host-local', 'container-bridge', 'socket'));--> statement-breakpoint
ALTER TABLE "infra"."network_link" ADD CONSTRAINT "infra_network_link_endpoint_kind_valid" CHECK ("infra"."network_link"."source_kind" IN ('substrate', 'host', 'runtime', 'dns-domain', 'ip-address', 'route', 'component-deployment') AND "infra"."network_link"."target_kind" IN ('substrate', 'host', 'runtime', 'dns-domain', 'ip-address', 'route', 'component-deployment'));--> statement-breakpoint
ALTER TABLE "infra"."runtime" ADD CONSTRAINT "infra_runtime_type_valid" CHECK ("infra"."runtime"."type" IN ('k8s-cluster', 'k8s-namespace', 'docker-engine', 'compose-project', 'systemd', 'reverse-proxy', 'iis', 'windows-service', 'process', 'firewall', 'router'));--> statement-breakpoint
ALTER TABLE "infra"."substrate" ADD CONSTRAINT "infra_substrate_type_valid" CHECK ("infra"."substrate"."type" IN ('cloud-account', 'region', 'datacenter', 'vpc', 'subnet', 'hypervisor', 'rack', 'dns-zone', 'wan'));