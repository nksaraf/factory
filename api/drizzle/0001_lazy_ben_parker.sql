CREATE TABLE "factory_infra"."datacenter" (
	"datacenter_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"region_id" text NOT NULL,
	"availability_zone" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."host" (
	"host_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"hostname" text,
	"provider_id" text NOT NULL,
	"datacenter_id" text,
	"ip_address" text,
	"ipmi_address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"cpu_cores" integer NOT NULL,
	"memory_mb" integer NOT NULL,
	"disk_gb" integer NOT NULL,
	"rack_location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_status_valid" CHECK ("factory_infra"."host"."status" IN ('active', 'maintenance', 'offline', 'decommissioned'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."ip_address" (
	"ip_address_id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"subnet_id" text,
	"assigned_to_type" text,
	"assigned_to_id" text,
	"status" text DEFAULT 'available' NOT NULL,
	"hostname" text,
	"fqdn" text,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ip_status_valid" CHECK ("factory_infra"."ip_address"."status" IN ('available', 'assigned', 'reserved', 'dhcp')),
	CONSTRAINT "ip_assigned_to_type_valid" CHECK ("factory_infra"."ip_address"."assigned_to_type" IS NULL OR "factory_infra"."ip_address"."assigned_to_type" IN ('vm', 'host', 'kube_node', 'cluster', 'service'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."kube_node" (
	"kube_node_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cluster_id" text NOT NULL,
	"vm_id" text,
	"role" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"ip_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kube_node_role_valid" CHECK ("factory_infra"."kube_node"."role" IN ('server', 'agent')),
	CONSTRAINT "kube_node_status_valid" CHECK ("factory_infra"."kube_node"."status" IN ('ready', 'not_ready', 'paused', 'evacuating'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."proxmox_cluster" (
	"proxmox_cluster_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider_id" text NOT NULL,
	"api_host" text NOT NULL,
	"api_port" integer DEFAULT 8006 NOT NULL,
	"token_id" text,
	"token_secret" text,
	"ssl_fingerprint" text,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_status_valid" CHECK ("factory_infra"."proxmox_cluster"."sync_status" IN ('idle', 'syncing', 'error'))
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."region" (
	"region_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"slug" text NOT NULL,
	"country" text,
	"city" text,
	"timezone" text,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_infra"."subnet" (
	"subnet_id" text PRIMARY KEY NOT NULL,
	"cidr" text NOT NULL,
	"gateway" text,
	"netmask" text,
	"vlan_id" integer,
	"vlan_name" text,
	"datacenter_id" text,
	"subnet_type" text DEFAULT 'vm' NOT NULL,
	"description" text,
	"dns_servers" text,
	"dns_domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subnet_type_valid" CHECK ("factory_infra"."subnet"."subnet_type" IN ('management', 'storage', 'vm', 'public', 'private', 'other'))
);
--> statement-breakpoint
ALTER TABLE "factory_infra"."provider" ADD COLUMN "provider_kind" text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD COLUMN "datacenter_id" text;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD COLUMN "host_id" text;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD COLUMN "cluster_id" text;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD COLUMN "proxmox_cluster_id" text;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD COLUMN "proxmox_vmid" integer;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD COLUMN "vm_type" text DEFAULT 'qemu' NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD COLUMN "ssh_user" text;--> statement-breakpoint
ALTER TABLE "factory_infra"."datacenter" ADD CONSTRAINT "datacenter_region_id_region_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "factory_infra"."region"("region_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."host" ADD CONSTRAINT "host_provider_id_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "factory_infra"."provider"("provider_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."host" ADD CONSTRAINT "host_datacenter_id_datacenter_datacenter_id_fk" FOREIGN KEY ("datacenter_id") REFERENCES "factory_infra"."datacenter"("datacenter_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."ip_address" ADD CONSTRAINT "ip_address_subnet_id_subnet_subnet_id_fk" FOREIGN KEY ("subnet_id") REFERENCES "factory_infra"."subnet"("subnet_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."kube_node" ADD CONSTRAINT "kube_node_cluster_id_cluster_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "factory_infra"."cluster"("cluster_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."kube_node" ADD CONSTRAINT "kube_node_vm_id_vm_vm_id_fk" FOREIGN KEY ("vm_id") REFERENCES "factory_infra"."vm"("vm_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."proxmox_cluster" ADD CONSTRAINT "proxmox_cluster_provider_id_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "factory_infra"."provider"("provider_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."region" ADD CONSTRAINT "region_provider_id_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "factory_infra"."provider"("provider_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."subnet" ADD CONSTRAINT "subnet_datacenter_id_datacenter_datacenter_id_fk" FOREIGN KEY ("datacenter_id") REFERENCES "factory_infra"."datacenter"("datacenter_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "datacenter_name_region_unique" ON "factory_infra"."datacenter" USING btree ("name","region_id");--> statement-breakpoint
CREATE UNIQUE INDEX "host_name_unique" ON "factory_infra"."host" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "ip_address_unique" ON "factory_infra"."ip_address" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "kube_node_cluster_name_unique" ON "factory_infra"."kube_node" USING btree ("cluster_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "proxmox_cluster_name_unique" ON "factory_infra"."proxmox_cluster" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "region_slug_unique" ON "factory_infra"."region" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "subnet_cidr_unique" ON "factory_infra"."subnet" USING btree ("cidr");--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD CONSTRAINT "vm_datacenter_id_datacenter_datacenter_id_fk" FOREIGN KEY ("datacenter_id") REFERENCES "factory_infra"."datacenter"("datacenter_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD CONSTRAINT "vm_host_id_host_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "factory_infra"."host"("host_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD CONSTRAINT "vm_cluster_id_cluster_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "factory_infra"."cluster"("cluster_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."vm" ADD CONSTRAINT "vm_proxmox_cluster_id_proxmox_cluster_proxmox_cluster_id_fk" FOREIGN KEY ("proxmox_cluster_id") REFERENCES "factory_infra"."proxmox_cluster"("proxmox_cluster_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_infra"."provider" ADD CONSTRAINT "provider_kind_valid" CHECK ("factory_infra"."provider"."provider_kind" IN ('internal', 'cloud', 'partner'));
