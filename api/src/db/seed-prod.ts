/**
 * Production seed — org root team + real infrastructure only (v2 schemas).
 * No fleet test data, no catalog, no commerce.
 *
 * Run: FACTORY_DATABASE_URL=postgres://... bun run api/src/db/seed-prod.ts
 */

import { sql } from "drizzle-orm";
import { connection } from "./connection";
import { team } from "./schema/org-v2";
import { substrate, host, ipAddress } from "./schema/infra-v2";
import { gitHostProvider } from "./schema/build-v2";
import { messagingProvider } from "./schema/org-v2";
import { workTrackerProvider } from "./schema/build-v2";
import { newId, type EntityPrefix } from "../lib/id";

const db = connection(
  process.env.FACTORY_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/postgres"
);

// ── ID Map ───────────────────────────────────────────────────────
const ids: Record<string, Record<string, string>> = {};

function id(ns: string, key: string, prefix: EntityPrefix): string {
  if (!ids[ns]) ids[ns] = {};
  if (!ids[ns][key]) ids[ns][key] = newId(prefix);
  return ids[ns][key];
}

// ── Org (minimal) ────────────────────────────────────────────────

async function seedOrg() {
  const rootTeamId = id("team", "lepton", "team");
  const engTeamId = id("team", "engineering", "team");
  const platformTeamId = id("team", "platform", "team");
  const productTeamId = id("team", "product", "team");
  const qaTeamId = id("team", "qa", "team");

  await db.insert(team).values([
    { id: rootTeamId, name: "Lepton", slug: "lepton", type: "business-unit", spec: { description: "Lepton Technologies" } },
    { id: engTeamId, name: "Engineering", slug: "engineering", type: "product-area", parentTeamId: rootTeamId, spec: { description: "All product engineering teams" } },
    { id: platformTeamId, name: "Platform", slug: "platform", type: "product-area", parentTeamId: rootTeamId, spec: { description: "Infrastructure and developer experience" } },
    { id: productTeamId, name: "Product", slug: "product", type: "product-area", parentTeamId: rootTeamId, spec: { description: "Product management" } },
    { id: qaTeamId, name: "QA", slug: "qa", type: "team", parentTeamId: rootTeamId, spec: { description: "Quality assurance" } },
  ]);

  return rootTeamId;
}

// ── Infra (real Proxmox data) ────────────────────────────────────

async function seedInfra() {
  // --- Substrate hierarchy ---
  // cloud-account → datacenter → hypervisor + subnets

  const cloudAccountId = id("subs", "lepton-proxmox", "subs");
  const gcpAccountId = id("subs", "google-gcp", "subs");
  const datacenterId = id("subs", "lepton-dc", "subs");
  const hypervisorId = id("subs", "pve-cluster-01", "subs");
  const mgmtSubnetId = id("subs", "mgmt-subnet", "subs");
  const vmSubnetId = id("subs", "vm-subnet", "subs");

  await db.insert(substrate).values([
    // Cloud accounts (top-level)
    {
      id: cloudAccountId, slug: "lepton-proxmox", name: "Lepton (Proxmox)", type: "cloud-account",
      spec: { providerKind: "proxmox", lifecycle: "active", syncStatus: "idle", metadata: {} },
    },
    {
      id: gcpAccountId, slug: "google-gcp", name: "Google Cloud", type: "cloud-account",
      spec: { providerKind: "gcp", lifecycle: "active", syncStatus: "idle", metadata: {} },
    },
    // Datacenter
    {
      id: datacenterId, slug: "lepton-datacenter", name: "Lepton Datacenter", type: "datacenter",
      parentSubstrateId: cloudAccountId,
      spec: { location: "Gurgaon, IN", lifecycle: "active", syncStatus: "idle", metadata: {} },
    },
    // Hypervisor (Proxmox cluster) — contains connection credentials
    {
      id: hypervisorId, slug: "pve-cluster-01", name: "Lepton PVE Cluster", type: "hypervisor",
      parentSubstrateId: datacenterId,
      spec: {
        providerKind: "proxmox",
        apiHost: "192.168.1.1",
        apiPort: 8006,
        tokenId: process.env.PVE_TOKEN_ID ?? "root@pam!nirvana",
        tokenSecret: process.env.PVE_TOKEN_SECRET ?? "",
        lifecycle: "active",
        syncStatus: "idle",
        metadata: {},
      },
    },
    // Subnets
    {
      id: mgmtSubnetId, slug: "mgmt-subnet", name: "Management Network", type: "subnet",
      parentSubstrateId: datacenterId,
      spec: { lifecycle: "active", syncStatus: "idle", metadata: { cidr: "192.168.1.0/24", gateway: "192.168.1.1", netmask: "255.255.255.0", description: "Management / Proxmox node network" } },
    },
    {
      id: vmSubnetId, slug: "vm-subnet", name: "VM Network", type: "subnet",
      parentSubstrateId: datacenterId,
      spec: { lifecycle: "active", syncStatus: "idle", metadata: { cidr: "192.168.2.0/24", gateway: "192.168.2.1", netmask: "255.255.255.0", description: "VM network" } },
    },
  ]);

  // --- Hosts (Proxmox bare-metal nodes) ---
  const bareMetalHosts = [
    { key: "lepton-squirtle", ip: "192.168.1.1", cpu: 40, memoryMb: 257568, diskGb: 94 },
    { key: "lepton-pikachu", ip: "192.168.1.132", cpu: 52, memoryMb: 257592, diskGb: 94 },
    { key: "lepton-charmander", ip: "192.168.1.70", cpu: 8, memoryMb: 15769, diskGb: 98 },
    { key: "lepton-59", ip: "192.168.1.59", cpu: 52, memoryMb: 262144, diskGb: 9216 },
  ];

  await db.insert(host).values(
    bareMetalHosts.map((h) => ({
      id: id("host", h.key, "host"),
      slug: h.key,
      name: h.key,
      type: "bare-metal" as const,
      substrateId: hypervisorId,
      spec: {
        hostname: h.key,
        os: "linux" as const,
        arch: "amd64" as const,
        cpu: h.cpu,
        memoryMb: h.memoryMb,
        diskGb: h.diskGb,
        accessMethod: "ssh" as const,
        accessUser: "root",
        sshPort: 22,
        ipAddress: h.ip,
        lifecycle: "active" as const,
      },
    })),
  );

  // --- VM Hosts ---
  const bToMb = (b: number) => Math.round(b / 1024 / 1024);
  const bToGb = (b: number) => Math.round(b / 1024 / 1024 / 1024);

  const vms = [
    { key: "app-smart-signal-fwa-stg", name: "app-smart-signal-fwa-stg", vmid: 100, ip: "192.168.2.79", status: "running", cpu: 4, mem: 2976653312, disk: 0 },
    { key: "k3s-master-2", name: "k3s-master-2", vmid: 101, ip: null, status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "docker-offline-install", name: "docker-offline-install", vmid: 102, ip: null, status: "stopped", cpu: 8, mem: 0, disk: 0 },
    { key: "ubuntugui", name: "UBUNTUGUI", vmid: 103, ip: null, status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "windows-samsung-sds", name: "windows-samsung-sds", vmid: 104, ip: "192.168.2.90", status: "running", cpu: 4, mem: 3522396160, disk: 0, os: "windows" as const },
    { key: "dev-lepton-admin", name: "dev-vikrant-trafficure", vmid: 105, ip: "192.168.2.26", status: "running", cpu: 8, mem: 6194130944, disk: 0 },
    { key: "app-trafficure-staging", name: "app-trafficure-staging", vmid: 106, ip: "192.168.2.97", status: "running", cpu: 16, mem: 32367026176, disk: 0 },
    { key: "dev-imran", name: "dev-imran", vmid: 107, ip: "192.168.2.73", status: "running", cpu: 4, mem: 12723826688, disk: 0 },
    { key: "smart-market", name: "smart-market", vmid: 108, ip: "192.168.2.77", status: "running", cpu: 16, mem: 17132052480, disk: 0 },
    { key: "dev-lepton-sm", name: "dev-lepton-sm", vmid: 109, ip: "192.168.2.75", status: "running", cpu: 4, mem: 21729181696, disk: 0 },
    { key: "bharatnet-mohali-vpn-jumpserver", name: "Bharatnet-Mohali-vpn-jumpserver", vmid: 111, ip: "192.168.2.47", status: "stopped", cpu: 3, mem: 0, disk: 0 },
    { key: "sonu-postgres-offline", name: "sonu-postgres-offline", vmid: 112, ip: null, status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "postgres-offline", name: "postgres-offline", vmid: 113, ip: null, status: "stopped", cpu: 8, mem: 0, disk: 0 },
    { key: "service-graphhopper-australia-prod", name: "service-graphhopper-australia-prod", vmid: 114, ip: "192.168.2.81", status: "running", cpu: 16, mem: 7013134336, disk: 0 },
    { key: "factory-prod", name: "factory-prod", vmid: 115, ip: "192.168.2.88", status: "running", cpu: 2, mem: 4294967296, disk: 0 },
    { key: "dev-lepton-smartmarket", name: "Road-Selectio-Tool-Prod", vmid: 116, ip: "192.168.2.74", status: "running", cpu: 8, mem: 12076003328, disk: 0 },
    { key: "dev-ritvik-trafficure", name: "dev-ritvik-trafficure", vmid: 117, ip: "192.168.2.85", status: "running", cpu: 8, mem: 13221793792, disk: 0 },
    { key: "uat-lepton-smartmarket", name: "uat-lepton-smartmarket", vmid: 118, ip: null, status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "docker-27", name: "docker-27", vmid: 119, ip: null, status: "stopped", cpu: 8, mem: 0, disk: 0 },
    { key: "dockerhub", name: "dockerhub", vmid: 120, ip: "192.168.2.92", status: "running", cpu: 4, mem: 3320680448, disk: 0 },
    { key: "vpn-ather-sm-windows", name: "vpn-ather-sm-windows", vmid: 121, ip: "192.168.2.78", status: "running", cpu: 16, mem: 5742129152, disk: 0 },
    { key: "service-planet-windows-trial", name: "service-planet-windows-trial", vmid: 122, ip: "192.168.2.70", status: "running", cpu: 12, mem: 4081917952, disk: 0 },
    { key: "service-smart-tender-prod", name: "service-smart-tender-prod", vmid: 123, ip: "192.168.2.71", status: "running", cpu: 8, mem: 9633501184, disk: 0 },
    { key: "app-trafficure-prod", name: "app-trafficure-prod", vmid: 124, ip: "192.168.2.86", status: "running", cpu: 8, mem: 15815987200, disk: 0 },
    { key: "jenkins-dev", name: "jenkins-dev", vmid: 125, ip: "192.168.2.25", status: "running", cpu: 4, mem: 4186517504, disk: 0 },
    { key: "vm-criticalreplicadbserver", name: "VM-CriticalReplicadbserver", vmid: 126, ip: null, status: "running", cpu: 20, mem: 15228141568, disk: 0 },
    { key: "cloud-controller", name: "cloud-controller", vmid: 127, ip: "192.168.2.89", status: "running", cpu: 4, mem: 13848596480, disk: 0 },
    { key: "dev-sonu", name: "dev-sonu", vmid: 128, ip: "192.168.2.99", status: "running", cpu: 32, mem: 13772083200, disk: 0 },
    { key: "trafficure-stress-test", name: "trafficure-stress-test", vmid: 129, ip: "192.168.2.95", status: "running", cpu: 8, mem: 24653668352, disk: 0 },
    { key: "service-zero-sync", name: "service-zero-sync", vmid: 130, ip: "192.168.2.87", status: "running", cpu: 4, mem: 11167010816, disk: 0 },
    { key: "service-zero-smart-tender", name: "service-zero-smart-tender", vmid: 131, ip: null, status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "backstage", name: "backstage", vmid: 132, ip: "192.168.2.96", status: "running", cpu: 4, mem: 5780951040, disk: 0 },
    { key: "app-smart-signal-sc2-stg", name: "app-smart-signal-sc2-stg", vmid: 133, ip: "192.168.2.83", status: "running", cpu: 4, mem: 10732871680, disk: 0 },
    { key: "backend-dev", name: "backend-dev", vmid: 134, ip: "192.168.2.80", status: "running", cpu: 40, mem: 56439701504, disk: 0 },
    { key: "app-smart-market-2-stg", name: "app-smart-market-2-stg", vmid: 135, ip: "192.168.2.76", status: "running", cpu: 4, mem: 16027955200, disk: 0 },
    { key: "gcp-bill-alert", name: "gcp-bill-alert", vmid: 136, ip: "192.168.2.94", status: "running", cpu: 12, mem: 15424360448, disk: 0 },
    { key: "dev-ritvik-2", name: "dev-ritvik-2", vmid: 137, ip: "192.168.2.72", status: "running", cpu: 8, mem: 1737650176, disk: 0 },
    { key: "bff-service", name: "bff-service", vmid: 138, ip: "192.168.2.153", status: "running", cpu: 2, mem: 4294967296, disk: 0 },
    { key: "workflow-engine", name: "workflow-engine", vmid: 139, ip: "192.168.2.91", status: "running", cpu: 4, mem: 3447783424, disk: 0 },
    { key: "traffic-chennai", name: "platform", vmid: 141, ip: "192.168.2.88", status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "dev-vishwa-trafficure", name: "dev-vishwa-trafficure", vmid: 144, ip: "192.168.2.98", status: "running", cpu: 8, mem: 14081396736, disk: 0 },
    { key: "puru-vm", name: "puru-vm", vmid: 146, ip: "192.168.2.100", status: "running", cpu: 8, mem: 15834746880, disk: 0 },
    { key: "utc-app-trafficure", name: "app-trafficure-dev-server", vmid: 147, ip: "192.168.2.51", status: "running", cpu: 16, mem: 29863038976, disk: 0 },
    { key: "parth-vm", name: "parth-vm", vmid: 148, ip: "192.168.2.93", status: "running", cpu: 8, mem: 16181796864, disk: 0 },
    { key: "clickstack-lepton-api-149", name: "clickstack-lepton-api-old", vmid: 149, ip: null, status: "stopped", cpu: 12, mem: 0, disk: 0 },
    { key: "clickstack-lepton-api", name: "clickstack-lepton-api", vmid: 150, ip: null, status: "running", cpu: 4, mem: 7909044224, disk: 0 },
  ];

  await db.insert(host).values(
    vms.map((v) => ({
      id: id("host", v.key, "host"),
      slug: v.key,
      name: v.name,
      type: "vm" as const,
      substrateId: hypervisorId,
      spec: {
        hostname: v.name,
        os: ((v as any).os ?? "linux") as "linux" | "windows",
        arch: "amd64" as const,
        cpu: v.cpu,
        memoryMb: v.mem > 0 ? bToMb(v.mem) : 0,
        diskGb: v.disk > 0 ? bToGb(v.disk) : 0,
        accessMethod: ((v as any).os === "windows" ? "rdp" : "ssh") as "ssh" | "rdp",
        accessUser: (v as any).os === "windows" ? "Administrator" : "root",
        sshPort: 22,
        ipAddress: v.ip ?? undefined,
        externalId: v.vmid ? String(v.vmid) : undefined,
        lifecycle: (v.status === "running" ? "active" : "offline") as "active" | "offline",
      },
    })),
  );

  // --- IP Addresses ---
  const ipEntries: { address: string; assignedToType: string; assignedToId: string; subnet: string }[] = [
    ...bareMetalHosts.map((h) => ({
      address: h.ip,
      assignedToType: "host",
      assignedToId: id("host", h.key, "host"),
      subnet: "mgmt",
    })),
  ];

  const seenIps = new Set(ipEntries.map((e) => e.address));
  const sortedVms = [...vms].sort((a, b) => (a.status === "running" ? -1 : 1) - (b.status === "running" ? -1 : 1));
  for (const v of sortedVms) {
    if (v.ip && v.ip.startsWith("192.168.") && !seenIps.has(v.ip)) {
      seenIps.add(v.ip);
      ipEntries.push({
        address: v.ip,
        assignedToType: "host",
        assignedToId: id("host", v.key, "host"),
        subnet: v.ip.startsWith("192.168.1.") ? "mgmt" : "vm",
      });
    }
  }

  await db.insert(ipAddress).values(
    ipEntries.map((e) => ({
      address: e.address,
      subnetId: e.subnet === "mgmt" ? mgmtSubnetId : vmSubnetId,
      spec: {
        version: "v4" as const,
        status: "assigned" as const,
        assignedToType: e.assignedToType,
        assignedToId: e.assignedToId,
      },
    })),
  );
}

// ── Identity Providers ──────────────────────────────────────────

async function seedProviders(rootTeamId: string) {
  await db.insert(gitHostProvider).values({
    slug: "github-lepton", name: "GitHub (Lepton)", type: "github",
    spec: {
      apiUrl: "https://api.github.com",
      authMode: "token",
      credentialsRef: "$secret(github-pat)",
      status: "active",
      syncStatus: "idle",
    },
  });

  await db.insert(messagingProvider).values({
    slug: "slack-lepton", name: "Slack (Lepton)", type: "slack",
    teamId: rootTeamId,
    spec: {
      botToken: "$secret(slack-bot-token)",
      signingSecret: "$secret(slack-signing-secret)",
      workspaceId: "$secret(slack-workspace-id)",
      status: "active",
    },
  });

  await db.insert(workTrackerProvider).values({
    slug: "jira-lepton", name: "Jira (Lepton)", type: "jira",
    teamId: rootTeamId,
    spec: {
      apiUrl: "https://leptonsoftware.atlassian.net",
      credentialsRef: "$secret(jira-api-token)",
      defaultRepoFullName: "nicholasgasior/gogo-factory",
      defaultBaseBranch: "main",
      status: "active",
    } as any,
  });
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log("Production seed (v2): org + infra + providers\n");

  // Truncate v2 tables
  await db.execute(sql`
    TRUNCATE
      infra.ip_address,
      infra.host,
      infra.network_link,
      infra.tunnel,
      infra.route,
      infra.runtime,
      infra.substrate,
      org.identity_link,
      org.membership,
      org.tool_usage,
      org.tool_credential,
      org.principal,
      org.team,
      build.git_host_provider,
      build.work_tracker_provider,
      org.messaging_provider
    CASCADE
  `);

  const rootTeamId = await seedOrg();
  console.log("  [1/3] Org seeded (teams)");

  await seedInfra();
  console.log("  [2/3] Infra seeded (substrates, hosts, IPs)");

  await seedProviders(rootTeamId);
  console.log("  [3/3] Identity providers seeded (GitHub, Slack, Jira)");

  console.log("\nProduction seed complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
