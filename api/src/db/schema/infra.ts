import { sql } from "drizzle-orm";
import { check, index, integer, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";

export const factoryInfra = pgSchema("factory_infra");

export const provider = factoryInfra.table(
  "provider",
  {
    providerId: text("provider_id")
      .primaryKey()
      .$defaultFn(() => newId("prv")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    providerType: text("provider_type").notNull(),
    url: text("url"),
    status: text("status").notNull().default("active"),
    credentialsRef: text("credentials_ref"),
    providerKind: text("provider_kind").notNull().default("internal"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("provider_slug_unique").on(t.slug),
  ]
);

export const cluster = factoryInfra.table(
  "cluster",
  {
    clusterId: text("cluster_id")
      .primaryKey()
      .$defaultFn(() => newId("cls")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.providerId, { onDelete: "restrict" }),
    status: text("status").notNull().default("provisioning"),
    kubeconfigRef: text("kubeconfig_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("cluster_name_unique").on(t.name),
    uniqueIndex("cluster_slug_unique").on(t.slug),
    check(
      "cluster_status_valid",
      sql`${t.status} IN ('provisioning', 'ready', 'degraded', 'destroying')`
    ),
  ]
);

export const region = factoryInfra.table(
  "region",
  {
    regionId: text("region_id")
      .primaryKey()
      .$defaultFn(() => newId("rgn")),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    slug: text("slug").notNull(),
    country: text("country"),
    city: text("city"),
    timezone: text("timezone"),
    providerId: text("provider_id")
      .references(() => provider.providerId, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("region_slug_unique").on(t.slug)]
);

export const datacenter = factoryInfra.table(
  "datacenter",
  {
    datacenterId: text("datacenter_id")
      .primaryKey()
      .$defaultFn(() => newId("dc")),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    slug: text("slug").notNull(),
    regionId: text("region_id")
      .notNull()
      .references(() => region.regionId, { onDelete: "restrict" }),
    availabilityZone: text("availability_zone"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("datacenter_name_region_unique").on(t.name, t.regionId),
    uniqueIndex("datacenter_region_slug_unique").on(t.regionId, t.slug),
  ]
);

export const host = factoryInfra.table(
  "host",
  {
    hostId: text("host_id")
      .primaryKey()
      .$defaultFn(() => newId("host")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    hostname: text("hostname"),
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.providerId, { onDelete: "restrict" }),
    datacenterId: text("datacenter_id")
      .references(() => datacenter.datacenterId, { onDelete: "set null" }),
    ipAddress: text("ip_address"),
    ipmiAddress: text("ipmi_address"),
    status: text("status").notNull().default("active"),
    osType: text("os_type").notNull().default("linux"),
    accessMethod: text("access_method").notNull().default("ssh"),
    cpuCores: integer("cpu_cores").notNull(),
    memoryMb: integer("memory_mb").notNull(),
    diskGb: integer("disk_gb").notNull(),
    rackLocation: text("rack_location"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("host_name_unique").on(t.name),
    uniqueIndex("host_slug_unique").on(t.slug),
    check(
      "host_status_valid",
      sql`${t.status} IN ('active', 'maintenance', 'offline', 'decommissioned')`
    ),
    check(
      "host_os_type_valid",
      sql`${t.osType} IN ('linux', 'windows')`
    ),
    check(
      "host_access_method_valid",
      sql`${t.accessMethod} IN ('ssh', 'winrm', 'rdp')`
    ),
  ]
);

export const proxmoxCluster = factoryInfra.table(
  "proxmox_cluster",
  {
    proxmoxClusterId: text("proxmox_cluster_id")
      .primaryKey()
      .$defaultFn(() => newId("pxc")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.providerId, { onDelete: "restrict" }),
    apiHost: text("api_host").notNull(),
    apiPort: integer("api_port").notNull().default(8006),
    tokenId: text("token_id"),
    tokenSecret: text("token_secret"),
    sslFingerprint: text("ssl_fingerprint"),
    syncStatus: text("sync_status").notNull().default("idle"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("proxmox_cluster_name_unique").on(t.name),
    uniqueIndex("proxmox_cluster_slug_unique").on(t.slug),
    check(
      "sync_status_valid",
      sql`${t.syncStatus} IN ('idle', 'syncing', 'error')`
    ),
  ]
);

export const vm = factoryInfra.table(
  "vm",
  {
    vmId: text("vm_id")
      .primaryKey()
      .$defaultFn(() => newId("vm")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.providerId, { onDelete: "restrict" }),
    datacenterId: text("datacenter_id")
      .references(() => datacenter.datacenterId, { onDelete: "set null" }),
    hostId: text("host_id")
      .references(() => host.hostId, { onDelete: "set null" }),
    clusterId: text("cluster_id")
      .references(() => cluster.clusterId, { onDelete: "set null" }),
    proxmoxClusterId: text("proxmox_cluster_id")
      .references(() => proxmoxCluster.proxmoxClusterId, { onDelete: "set null" }),
    proxmoxVmid: integer("proxmox_vmid"),
    vmType: text("vm_type").notNull().default("qemu"),
    status: text("status").notNull().default("provisioning"),
    osType: text("os_type").notNull().default("linux"),
    accessMethod: text("access_method").notNull().default("ssh"),
    accessUser: text("access_user"),
    cpu: integer("cpu").notNull(),
    memoryMb: integer("memory_mb").notNull(),
    diskGb: integer("disk_gb").notNull(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("vm_slug_unique").on(t.slug),
    check(
      "vm_status_valid",
      sql`${t.status} IN ('provisioning', 'running', 'stopped', 'destroying')`
    ),
    check(
      "vm_os_type_valid",
      sql`${t.osType} IN ('linux', 'windows')`
    ),
    check(
      "vm_access_method_valid",
      sql`${t.accessMethod} IN ('ssh', 'winrm', 'rdp')`
    ),
  ]
);

export const kubeNode = factoryInfra.table(
  "kube_node",
  {
    kubeNodeId: text("kube_node_id")
      .primaryKey()
      .$defaultFn(() => newId("kn")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => cluster.clusterId, { onDelete: "cascade" }),
    vmId: text("vm_id")
      .references(() => vm.vmId, { onDelete: "set null" }),
    role: text("role").notNull(),
    status: text("status").notNull().default("ready"),
    ipAddress: text("ip_address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("kube_node_cluster_name_unique").on(t.clusterId, t.name),
    uniqueIndex("kube_node_cluster_slug_unique").on(t.clusterId, t.slug),
    check(
      "kube_node_role_valid",
      sql`${t.role} IN ('server', 'agent')`
    ),
    check(
      "kube_node_status_valid",
      sql`${t.status} IN ('ready', 'not_ready', 'paused', 'evacuating')`
    ),
  ]
);

export const subnet = factoryInfra.table(
  "subnet",
  {
    subnetId: text("subnet_id")
      .primaryKey()
      .$defaultFn(() => newId("sub")),
    cidr: text("cidr").notNull(),
    gateway: text("gateway"),
    netmask: text("netmask"),
    vlanId: integer("vlan_id"),
    vlanName: text("vlan_name"),
    datacenterId: text("datacenter_id")
      .references(() => datacenter.datacenterId, { onDelete: "set null" }),
    subnetType: text("subnet_type").notNull().default("vm"),
    description: text("description"),
    dnsServers: text("dns_servers"),
    dnsDomain: text("dns_domain"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("subnet_cidr_unique").on(t.cidr),
    check(
      "subnet_type_valid",
      sql`${t.subnetType} IN ('management', 'storage', 'vm', 'public', 'private', 'other')`
    ),
  ]
);

export const ipAddress = factoryInfra.table(
  "ip_address",
  {
    ipAddressId: text("ip_address_id")
      .primaryKey()
      .$defaultFn(() => newId("ipa")),
    address: text("address").notNull(),
    subnetId: text("subnet_id")
      .references(() => subnet.subnetId, { onDelete: "set null" }),
    assignedToType: text("assigned_to_type"),
    assignedToId: text("assigned_to_id"),
    status: text("status").notNull().default("available"),
    hostname: text("hostname"),
    fqdn: text("fqdn"),
    purpose: text("purpose"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("ip_address_unique").on(t.address),
    check(
      "ip_status_valid",
      sql`${t.status} IN ('available', 'assigned', 'reserved', 'dhcp')`
    ),
    check(
      "ip_assigned_to_type_valid",
      sql`${t.assignedToType} IS NULL OR ${t.assignedToType} IN ('vm', 'host', 'kube_node', 'cluster', 'service')`
    ),
  ]
);

// ─── SSH Keys ───────────────────────────────────────────────
// Developer SSH public keys registered with Factory.
// Used for provisioning authorized_keys on VMs, sandboxes, and hosts.

export const sshKey = factoryInfra.table(
  "ssh_key",
  {
    sshKeyId: text("ssh_key_id")
      .primaryKey()
      .$defaultFn(() => newId("sshk")),
    principalId: text("principal_id").notNull(),
    name: text("name").notNull(),
    publicKey: text("public_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    keyType: text("key_type").notNull().default("ed25519"),
    status: text("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("ssh_key_fingerprint_unique").on(t.fingerprint),
    uniqueIndex("ssh_key_principal_name_unique").on(t.principalId, t.name),
    index("ssh_key_principal_idx").on(t.principalId),
    check(
      "ssh_key_type_valid",
      sql`${t.keyType} IN ('ed25519', 'rsa', 'ecdsa')`
    ),
    check(
      "ssh_key_status_valid",
      sql`${t.status} IN ('active', 'revoked')`
    ),
  ]
);
