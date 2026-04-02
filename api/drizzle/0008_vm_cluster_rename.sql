-- Rename proxmox_cluster → vm_cluster (generalize for any VM provider)
ALTER TABLE "factory_infra"."proxmox_cluster" RENAME TO "vm_cluster";
ALTER TABLE "factory_infra"."vm_cluster" RENAME COLUMN "proxmox_cluster_id" TO "vm_cluster_id";

-- Rename proxmox-specific columns on vm table
ALTER TABLE "factory_infra"."vm" RENAME COLUMN "proxmox_cluster_id" TO "vm_cluster_id";
ALTER TABLE "factory_infra"."vm" RENAME COLUMN "proxmox_vmid" TO "external_vmid";

-- Rename proxmox_snapshot_name on sandbox_snapshot table
ALTER TABLE "factory_fleet"."sandbox_snapshot" RENAME COLUMN "proxmox_snapshot_name" TO "external_snapshot_name";

-- Rename indexes
ALTER INDEX "factory_infra"."proxmox_cluster_name_unique" RENAME TO "vm_cluster_name_unique";
ALTER INDEX "factory_infra"."proxmox_cluster_slug_unique" RENAME TO "vm_cluster_slug_unique";
