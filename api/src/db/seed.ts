/**
 * Lepton Factory Seed Data
 *
 * Models the full complexity of Lepton's product portfolio:
 * - 7 products with 4-5 modules each
 * - 17 customers across 6 verticals
 * - Fork scenarios (Verizon, Walmart, BMW)
 * - Full infrastructure, catalog, build, fleet, gateway, and agent data
 *
 * Run: npx tsx api/src/db/seed.ts
 */

import { sql } from "drizzle-orm";
import { connection } from "./connection";
import * as s from "./schema";
import { newId, type EntityPrefix } from "../lib/id";

const db = connection(
  process.env.FACTORY_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/postgres"
);

// ── ID Map ───────────────────────────────────────────────────────
// Track generated IDs so FKs resolve across phases.

const ids: Record<string, Record<string, string>> = {};

function id(ns: string, key: string, prefix: EntityPrefix): string {
  if (!ids[ns]) ids[ns] = {};
  if (!ids[ns][key]) ids[ns][key] = newId(prefix);
  return ids[ns][key];
}

// ── Phase 1: Org ─────────────────────────────────────────────────

async function seedOrg() {
  // --- Teams (root first, then children) ---
  const rootTeamId = id("team", "lepton", "team");
  const engTeamId = id("team", "engineering", "team");
  const platformTeamId = id("team", "platform", "team");
  const productTeamId = id("team", "product", "team");
  const qaTeamId = id("team", "qa", "team");

  await db.insert(s.orgTeam).values([
    { teamId: rootTeamId, name: "Lepton", slug: "lepton", type: "business-unit", description: "Lepton Technologies" },
    { teamId: engTeamId, name: "Engineering", slug: "engineering", type: "product-area", parentTeamId: rootTeamId, description: "All product engineering teams" },
    { teamId: platformTeamId, name: "Platform", slug: "platform", type: "product-area", parentTeamId: rootTeamId, description: "Infrastructure and developer experience" },
    { teamId: productTeamId, name: "Product", slug: "product", type: "product-area", parentTeamId: rootTeamId, description: "Product management" },
    { teamId: qaTeamId, name: "QA", slug: "qa", type: "team", parentTeamId: rootTeamId, description: "Quality assurance" },
  ]);

  // Product-specific engineering teams
  const productTeams = [
    { key: "network-access", name: "Network Access", slug: "team-network-access" },
    { key: "smart-inventory", name: "Smart Inventory", slug: "team-smart-inventory" },
    { key: "smartops", name: "SmartOps", slug: "team-smartops" },
    { key: "smart-signal", name: "Smart Signal", slug: "team-smart-signal" },
    { key: "smartmarket", name: "SmartMarket", slug: "team-smartmarket" },
    { key: "trafficure", name: "Trafficure", slug: "team-trafficure" },
    { key: "neo360", name: "Neo360", slug: "team-neo360" },
  ];

  await db.insert(s.orgTeam).values(
    productTeams.map((t) => ({
      teamId: id("team", t.key, "team"),
      name: t.name,
      slug: t.slug,
      type: "team" as const,
      parentTeamId: engTeamId,
      description: `${t.name} product team`,
    }))
  );

  // Platform sub-teams
  const platformSubTeams = [
    { key: "infra", name: "Infrastructure", slug: "team-infra" },
    { key: "devex", name: "Developer Experience", slug: "team-devex" },
    { key: "security", name: "Security", slug: "team-security" },
  ];

  await db.insert(s.orgTeam).values(
    platformSubTeams.map((t) => ({
      teamId: id("team", t.key, "team"),
      name: t.name,
      slug: t.slug,
      type: "team" as const,
      parentTeamId: platformTeamId,
      description: `${t.name} team`,
    }))
  );

  // --- Principals ---
  const users = [
    { key: "alex-chen", name: "Alex Chen", email: "alex.chen@lepton.ai", team: "engineering", profile: { title: "VP Engineering" } },
    { key: "maria-garcia", name: "Maria Garcia", email: "maria.garcia@lepton.ai", team: "network-access", profile: { title: "Tech Lead" } },
    { key: "james-wilson", name: "James Wilson", email: "james.wilson@lepton.ai", team: "network-access", profile: { title: "Senior Engineer" } },
    { key: "sarah-johnson", name: "Sarah Johnson", email: "sarah.johnson@lepton.ai", team: "smart-inventory", profile: { title: "Tech Lead" } },
    { key: "david-kim", name: "David Kim", email: "david.kim@lepton.ai", team: "smart-inventory", profile: { title: "Engineer" } },
    { key: "lisa-wang", name: "Lisa Wang", email: "lisa.wang@lepton.ai", team: "smartops", profile: { title: "Tech Lead" } },
    { key: "mike-brown", name: "Mike Brown", email: "mike.brown@lepton.ai", team: "smartops", profile: { title: "Senior Engineer" } },
    { key: "emma-davis", name: "Emma Davis", email: "emma.davis@lepton.ai", team: "smart-signal", profile: { title: "Tech Lead" } },
    { key: "ryan-patel", name: "Ryan Patel", email: "ryan.patel@lepton.ai", team: "smart-signal", profile: { title: "Engineer" } },
    { key: "jenny-lee", name: "Jenny Lee", email: "jenny.lee@lepton.ai", team: "smartmarket", profile: { title: "Tech Lead" } },
    { key: "tom-smith", name: "Tom Smith", email: "tom.smith@lepton.ai", team: "smartmarket", profile: { title: "Engineer" } },
    { key: "ana-martinez", name: "Ana Martinez", email: "ana.martinez@lepton.ai", team: "trafficure", profile: { title: "Tech Lead" } },
    { key: "chris-nguyen", name: "Chris Nguyen", email: "chris.nguyen@lepton.ai", team: "trafficure", profile: { title: "Engineer" } },
    { key: "kenji-tanaka", name: "Kenji Tanaka", email: "kenji.tanaka@lepton.ai", team: "neo360", profile: { title: "Tech Lead" } },
    { key: "yuki-sato", name: "Yuki Sato", email: "yuki.sato@lepton.ai", team: "neo360", profile: { title: "Engineer" } },
    { key: "omar-hassan", name: "Omar Hassan", email: "omar.hassan@lepton.ai", team: "infra", profile: { title: "Platform Lead" } },
    { key: "priya-sharma", name: "Priya Sharma", email: "priya.sharma@lepton.ai", team: "infra", profile: { title: "SRE" } },
    { key: "jake-taylor", name: "Jake Taylor", email: "jake.taylor@lepton.ai", team: "devex", profile: { title: "DevEx Lead" } },
    { key: "nina-petrov", name: "Nina Petrov", email: "nina.petrov@lepton.ai", team: "security", profile: { title: "Security Lead" } },
    { key: "sam-reed", name: "Sam Reed", email: "sam.reed@lepton.ai", team: "product", profile: { title: "Head of Product" } },
    { key: "diana-ross", name: "Diana Ross", email: "diana.ross@lepton.ai", team: "product", profile: { title: "Product Manager" } },
    { key: "ben-clark", name: "Ben Clark", email: "ben.clark@lepton.ai", team: "qa", profile: { title: "QA Lead" } },
  ];

  await db.insert(s.orgPrincipal).values(
    users.map((u) => ({
      principalId: id("prin", u.key, "prin"),
      name: u.name,
      slug: u.key,
      type: "user" as const,
      teamId: id("team", u.team, "team"),
      email: u.email,
      profile: u.profile,
    }))
  );

  // Service accounts
  const serviceAccounts = [
    { key: "ci-bot", name: "CI Bot", team: "devex" },
    { key: "deploy-bot", name: "Deploy Bot", team: "infra" },
    { key: "monitoring-bot", name: "Monitoring Bot", team: "infra" },
  ];

  await db.insert(s.orgPrincipal).values(
    serviceAccounts.map((sa) => ({
      principalId: id("prin", sa.key, "prin"),
      name: sa.name,
      slug: sa.key,
      type: "service_account" as const,
      teamId: id("team", sa.team, "team"),
      email: `${sa.key}@lepton.ai`,
    }))
  );

  // --- Memberships (cross-team) ---
  const memberships = [
    { principal: "alex-chen", team: "lepton", role: "admin" },
    { principal: "alex-chen", team: "platform", role: "lead" },
    { principal: "omar-hassan", team: "engineering", role: "member" },
    { principal: "sam-reed", team: "engineering", role: "member" },
    { principal: "ben-clark", team: "engineering", role: "member" },
    { principal: "jake-taylor", team: "infra", role: "member" },
    { principal: "nina-petrov", team: "platform", role: "member" },
    { principal: "maria-garcia", team: "smartops", role: "member" },
    { principal: "kenji-tanaka", team: "engineering", role: "member" },
  ];

  await db.insert(s.orgPrincipalTeamMembership).values(
    memberships.map((m) => ({
      principalId: id("prin", m.principal, "prin"),
      teamId: id("team", m.team, "team"),
      role: m.role,
    }))
  );

  // --- Scopes ---
  const rootScopeId = id("scope", "root", "scope");
  await db.insert(s.orgScope).values([
    { scopeId: rootScopeId, name: "Lepton Root", slug: "lepton-root", type: "team", teamId: rootTeamId },
    { scopeId: id("scope", "eng", "scope"), name: "Engineering", slug: "scope-engineering", type: "team", parentScopeId: rootScopeId, teamId: engTeamId },
    { scopeId: id("scope", "platform", "scope"), name: "Platform", slug: "scope-platform", type: "team", parentScopeId: rootScopeId, teamId: platformTeamId },
    { scopeId: id("scope", "product", "scope"), name: "Product", slug: "scope-product", type: "team", parentScopeId: rootScopeId, teamId: productTeamId },
  ]);

  // --- Identity Links ---
  const identityUsers = ["alex-chen", "maria-garcia", "sarah-johnson", "lisa-wang", "omar-hassan", "jake-taylor", "kenji-tanaka"];
  await db.insert(s.identityLink).values(
    identityUsers.map((u) => ({
      principalId: id("prin", u, "prin"),
      provider: "github" as const,
      externalUserId: `gh_${u.replace(/-/g, "")}`,
      externalLogin: u,
      email: `${u.replace(/-/g, ".")}@lepton.ai`,
    }))
  );

  // --- Tool Credentials ---
  await db.insert(s.toolCredential).values([
    { principalId: id("prin", "alex-chen", "prin"), provider: "claude", keyName: "default", keyHash: "hash_alex_claude", keyPrefix: "sk_ant_" },
    { principalId: id("prin", "jake-taylor", "prin"), provider: "cursor", keyName: "default", keyHash: "hash_jake_cursor", keyPrefix: "cur_" },
    { principalId: id("prin", "maria-garcia", "prin"), provider: "claude", keyName: "default", keyHash: "hash_maria_claude", keyPrefix: "sk_ant_" },
  ]);
}

// ── Phase 2: Infra ───────────────────────────────────────────────
// Real infrastructure data from Proxmox production cluster (192.168.2.89)

async function seedInfra() {
  // --- Providers (from infra.provider @ 192.168.2.89) ---
  await db.insert(s.provider).values([
    { providerId: id("prv", "lepton", "prv"), name: "Lepton", slug: "lepton", providerType: "proxmox", providerKind: "internal" },
    { providerId: id("prv", "google", "prv"), name: "Google", slug: "google", providerType: "gcp", providerKind: "cloud" },
    { providerId: id("prv", "cyfuture", "prv"), name: "Cyfuture", slug: "cyfuture", providerType: "partner", providerKind: "partner" },
    { providerId: id("prv", "hetzner", "prv"), name: "Hetzner", slug: "hetzner", providerType: "hetzner", providerKind: "partner" },
    { providerId: id("prv", "samsung", "prv"), name: "Samsung", slug: "samsung", providerType: "partner", providerKind: "partner" },
  ]);

  // --- Regions ---
  await db.insert(s.region).values([
    { regionId: id("rgn", "gurgaon", "rgn"), name: "gurgaon", displayName: "Gurgaon", slug: "gurgaon", country: "IN", providerId: id("prv", "lepton", "prv") },
    { regionId: id("rgn", "asia-south2", "rgn"), name: "Asia South (Delhi)", displayName: "Asia South (Delhi)", slug: "asia-south2", country: "IN", providerId: id("prv", "google", "prv") },
    { regionId: id("rgn", "asia-south1", "rgn"), name: "Asia South (Mumbai)", displayName: "Asia South (Mumbai)", slug: "asia-south1", country: "IN", providerId: id("prv", "google", "prv") },
    { regionId: id("rgn", "samsung-01", "rgn"), name: "Samsung 01", displayName: "Samsung 01", slug: "samsung-01", country: "IN", providerId: id("prv", "samsung", "prv") },
  ]);

  // --- Datacenters ---
  await db.insert(s.datacenter).values([
    { datacenterId: id("dc", "lepton-dc", "dc"), name: "lepton-datacenter", displayName: "Lepton Datacenter", slug: "lepton-datacenter", regionId: id("rgn", "gurgaon", "rgn") },
  ]);

  // --- Hosts (from infra.host — real Proxmox nodes + bare metal) ---
  await db.insert(s.host).values([
    { hostId: id("host", "lepton-squirtle", "host"), name: "lepton-squirtle", slug: "lepton-squirtle", hostname: "lepton-squirtle", providerId: id("prv", "lepton", "prv"), datacenterId: id("dc", "lepton-dc", "dc"), ipAddress: "192.168.1.1", cpuCores: 40, memoryMb: 257568, diskGb: 94, status: "active", osType: "linux" },
    { hostId: id("host", "lepton-pikachu", "host"), name: "lepton-pikachu", slug: "lepton-pikachu", hostname: "lepton-pikachu", providerId: id("prv", "lepton", "prv"), datacenterId: id("dc", "lepton-dc", "dc"), ipAddress: "192.168.1.132", cpuCores: 52, memoryMb: 257592, diskGb: 94, status: "active", osType: "linux" },
    { hostId: id("host", "lepton-charmander", "host"), name: "lepton-charmander", slug: "lepton-charmander", hostname: "lepton-charmander", providerId: id("prv", "lepton", "prv"), datacenterId: id("dc", "lepton-dc", "dc"), ipAddress: "192.168.1.70", cpuCores: 8, memoryMb: 15769, diskGb: 98, status: "active", osType: "linux" },
    { hostId: id("host", "lepton-59", "host"), name: "lepton-59", slug: "lepton-59", hostname: "lepton-59", providerId: id("prv", "lepton", "prv"), datacenterId: id("dc", "lepton-dc", "dc"), ipAddress: "192.168.1.59", cpuCores: 52, memoryMb: 262144, diskGb: 9216, status: "active", osType: "linux" },
    { hostId: id("host", "samsung-smart-market-prod", "host"), name: "samsung-smart-market-prod", slug: "samsung-smart-market-prod", hostname: "samsung-smart-market-prod", providerId: id("prv", "samsung", "prv"), ipAddress: "0.0.0.0", cpuCores: 2, memoryMb: 2048, diskGb: 50, status: "active", osType: "linux" },
  ]);

  // --- VM Cluster (Proxmox cluster: lepton-datacenter) ---
  await db.insert(s.vmCluster).values([
    { vmClusterId: id("vmc", "lepton-dc", "vmc"), name: "lepton-datacenter", slug: "lepton-datacenter", providerId: id("prv", "lepton", "prv"), apiHost: "192.168.1.1", apiPort: 8006, tokenId: "root@pam!nirvana", tokenSecret: "ec0de73f-afaa-41c3-a75d-1c6635d92cd2", syncStatus: "idle" },
  ]);

  // --- Kubernetes Clusters (logical clusters, referenced by fleet) ---
  const clusters = [
    { key: "factory-core", name: "factory-core", prv: "lepton", status: "ready" },
    { key: "site-us-east-prod", name: "site-us-east-prod", prv: "lepton", status: "ready" },
    { key: "site-us-east-staging", name: "site-us-east-staging", prv: "lepton", status: "ready" },
    { key: "site-us-west-prod", name: "site-us-west-prod", prv: "lepton", status: "ready" },
    { key: "site-eu-fra-prod", name: "site-eu-fra-prod", prv: "lepton", status: "ready" },
    { key: "site-eu-fra-staging", name: "site-eu-fra-staging", prv: "lepton", status: "ready" },
    { key: "site-apac-sg-prod", name: "site-apac-sg-prod", prv: "lepton", status: "ready" },
    { key: "dev-sandbox", name: "dev-sandbox", prv: "lepton", status: "ready" },
  ];

  await db.insert(s.cluster).values(
    clusters.map((c) => ({
      clusterId: id("cls", c.key, "cls"),
      name: c.name,
      slug: c.key,
      providerId: id("prv", c.prv, "prv"),
      status: c.status,
      kubeconfigRef: `vault:secret/kubeconfig/${c.key}`,
    }))
  );

  // --- VMs (48 real VMs from Proxmox) ---
  // Helper: convert bytes to MB (rounded)
  const bToMb = (b: number) => Math.round(b / 1024 / 1024);
  const bToGb = (b: number) => Math.round(b / 1024 / 1024 / 1024);

  // Map proxmox_node_id → host key for hostId FK
  const nodeToHost: Record<string, string> = {
    "squirtle": "lepton-squirtle",
    "pikachu": "lepton-pikachu",
    "charmander": "lepton-charmander",
  };

  const vms = [
    { key: "app-smart-signal-fwa-stg", name: "app-smart-signal-fwa-stg", slug: "app-smart-signal-fwa-stg", vmid: 100, node: "squirtle", ip: "192.168.2.79", status: "running", cpu: 4, mem: 2976653312, disk: 0 },
    { key: "k3s-master-2", name: "k3s-master-2", slug: "k3s-master-2", vmid: 101, node: "charmander", ip: null, status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "docker-offline-install", name: "docker-offline-install", slug: "docker-offline-install", vmid: 102, node: "pikachu", ip: null, status: "stopped", cpu: 8, mem: 0, disk: 0 },
    { key: "ubuntugui", name: "UBUNTUGUI", slug: "ubuntugui", vmid: 103, node: "pikachu", ip: null, status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "windows-samsung-sds", name: "windows-samsung-sds", slug: "windows-samsung-sds", vmid: 104, node: "pikachu", ip: "192.168.2.90", status: "running", cpu: 4, mem: 3522396160, disk: 0, os: "windows" as const },
    { key: "dev-lepton-admin", name: "dev-vikrant-trafficure", slug: "dev-lepton-admin", vmid: 105, node: "squirtle", ip: "192.168.2.26", status: "running", cpu: 8, mem: 6194130944, disk: 0 },
    { key: "app-trafficure-staging", name: "app-trafficure-staging", slug: "app-trafficure-staging", vmid: 106, node: "squirtle", ip: "192.168.2.97", status: "running", cpu: 16, mem: 32367026176, disk: 0 },
    { key: "dev-imran", name: "dev-imran", slug: "dev-imran", vmid: 107, node: "squirtle", ip: "192.168.2.73", status: "running", cpu: 4, mem: 12723826688, disk: 0 },
    { key: "smart-market", name: "smart-market", slug: "smart-market", vmid: 108, node: "pikachu", ip: "192.168.2.77", status: "running", cpu: 16, mem: 17132052480, disk: 0 },
    { key: "dev-lepton-sm", name: "dev-lepton-sm", slug: "dev-lepton-sm", vmid: 109, node: "squirtle", ip: "192.168.2.75", status: "running", cpu: 4, mem: 21729181696, disk: 0 },
    { key: "bharatnet-mohali-vpn-jumpserver", name: "Bharatnet-Mohali-vpn-jumpserver", slug: "bharatnet-mohali-vpn-jumpserver", vmid: 111, node: "charmander", ip: "192.168.2.47", status: "stopped", cpu: 3, mem: 0, disk: 0 },
    { key: "sonu-postgres-offline", name: "sonu-postgres-offline", slug: "sonu-postgres-offline", vmid: 112, node: "pikachu", ip: null, status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "postgres-offline", name: "postgres-offline", slug: "postgres-offline", vmid: 113, node: "pikachu", ip: null, status: "stopped", cpu: 8, mem: 0, disk: 0 },
    { key: "service-graphhopper-australia-prod", name: "service-graphhopper-australia-prod", slug: "service-graphhopper-australia-prod", vmid: 114, node: "pikachu", ip: "192.168.2.81", status: "running", cpu: 16, mem: 7013134336, disk: 0 },
    { key: "factory-prod", name: "factory-prod", slug: "factory-prod", vmid: 115, node: "squirtle", ip: "192.168.2.88", status: "running", cpu: 2, mem: 4294967296, disk: 0 },
    { key: "dev-lepton-smartmarket", name: "Road-Selectio-Tool-Prod", slug: "dev-lepton-smartmarket", vmid: 116, node: "pikachu", ip: "192.168.2.74", status: "running", cpu: 8, mem: 12076003328, disk: 0 },
    { key: "dev-ritvik-trafficure", name: "dev-ritvik-trafficure", slug: "dev-ritvik-trafficure", vmid: 117, node: "squirtle", ip: "192.168.2.85", status: "running", cpu: 8, mem: 13221793792, disk: 0 },
    { key: "uat-lepton-smartmarket", name: "uat-lepton-smartmarket", slug: "uat-lepton-smartmarket", vmid: 118, node: "pikachu", ip: null, status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "docker-27", name: "docker-27", slug: "docker-27", vmid: 119, node: "pikachu", ip: null, status: "stopped", cpu: 8, mem: 0, disk: 0 },
    { key: "dockerhub", name: "dockerhub", slug: "dockerhub", vmid: 120, node: "squirtle", ip: "192.168.2.92", status: "running", cpu: 4, mem: 3320680448, disk: 0 },
    { key: "vpn-ather-sm-windows", name: "vpn-ather-sm-windows", slug: "vpn-ather-sm-windows", vmid: 121, node: "pikachu", ip: "192.168.2.78", status: "running", cpu: 16, mem: 5742129152, disk: 0 },
    { key: "service-planet-windows-trial", name: "service-planet-windows-trial", slug: "service-planet-windows-trial", vmid: 122, node: "pikachu", ip: "192.168.2.70", status: "running", cpu: 12, mem: 4081917952, disk: 0 },
    { key: "service-smart-tender-prod", name: "service-smart-tender-prod", slug: "service-smart-tender-prod", vmid: 123, node: "pikachu", ip: "192.168.2.71", status: "running", cpu: 8, mem: 9633501184, disk: 0 },
    { key: "app-trafficure-prod", name: "app-trafficure-prod", slug: "app-trafficure-prod", vmid: 124, node: "pikachu", ip: "192.168.2.86", status: "running", cpu: 8, mem: 15815987200, disk: 0 },
    { key: "jenkins-dev", name: "jenkins-dev", slug: "jenkins-dev", vmid: 125, node: "pikachu", ip: "192.168.2.25", status: "running", cpu: 4, mem: 4186517504, disk: 0 },
    { key: "vm-criticalreplicadbserver", name: "VM-CriticalReplicadbserverSmartopsSmartMarket", slug: "vm-criticalreplicadbserversmartopssmartmarket", vmid: 126, node: "squirtle", ip: null, status: "running", cpu: 20, mem: 15228141568, disk: 0 },
    { key: "cloud-controller", name: "cloud-controller", slug: "cloud-controller", vmid: 127, node: "squirtle", ip: "192.168.2.89", status: "running", cpu: 4, mem: 13848596480, disk: 0 },
    { key: "dev-sonu", name: "dev-sonu", slug: "dev-sonu", vmid: 128, node: "squirtle", ip: "192.168.2.99", status: "running", cpu: 32, mem: 13772083200, disk: 0 },
    { key: "trafficure-stress-test", name: "trafficure-stress-test", slug: "trafficure-stress-test", vmid: 129, node: "squirtle", ip: "192.168.2.95", status: "running", cpu: 8, mem: 24653668352, disk: 0 },
    { key: "service-zero-sync", name: "service-zero-sync", slug: "service-zero-sync", vmid: 130, node: "pikachu", ip: "192.168.2.87", status: "running", cpu: 4, mem: 11167010816, disk: 0 },
    { key: "service-zero-smart-tender", name: "service-zero-smart-tender", slug: "service-zero-smart-tender", vmid: 131, node: "pikachu", ip: null, status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "backstage", name: "backstage", slug: "backstage", vmid: 132, node: "squirtle", ip: "192.168.2.96", status: "running", cpu: 4, mem: 5780951040, disk: 0 },
    { key: "app-smart-signal-sc2-stg", name: "app-smart-signal-sc2-stg", slug: "app-smart-signal-sc2-stg", vmid: 133, node: "squirtle", ip: "192.168.2.83", status: "running", cpu: 4, mem: 10732871680, disk: 0 },
    { key: "backend-dev", name: "backend-dev", slug: "backend-dev", vmid: 134, node: "pikachu", ip: "192.168.2.80", status: "running", cpu: 40, mem: 56439701504, disk: 0 },
    { key: "app-smart-market-2-stg", name: "app-smart-market-2-stg", slug: "app-smart-market-2-stg", vmid: 135, node: "squirtle", ip: "192.168.2.76", status: "running", cpu: 4, mem: 16027955200, disk: 0 },
    { key: "gcp-bill-alert", name: "gcp-bill-alert", slug: "gcp-bill-alert", vmid: 136, node: "squirtle", ip: "192.168.2.94", status: "running", cpu: 12, mem: 15424360448, disk: 0 },
    { key: "dev-ritvik-2", name: "dev-ritvik-2", slug: "dev-ritvik-2", vmid: 137, node: "squirtle", ip: "192.168.2.72", status: "running", cpu: 8, mem: 1737650176, disk: 0 },
    { key: "bff-service", name: "bff-service", slug: "bff-service", vmid: 138, node: "squirtle", ip: "192.168.2.153", status: "running", cpu: 2, mem: 4294967296, disk: 0 },
    { key: "workflow-engine", name: "workflow-engine", slug: "workflow-engine", vmid: 139, node: "squirtle", ip: "192.168.2.91", status: "running", cpu: 4, mem: 3447783424, disk: 0 },
    { key: "traffic-chennai", name: "platform", slug: "traffic-chennai", vmid: 141, node: "squirtle", ip: "192.168.2.88", status: "stopped", cpu: 4, mem: 0, disk: 0 },
    { key: "dev-vishwa-trafficure", name: "dev-vishwa-trafficure", slug: "dev-vishwa-trafficure", vmid: 144, node: "squirtle", ip: "192.168.2.98", status: "running", cpu: 8, mem: 14081396736, disk: 0 },
    { key: "puru-vm", name: "puru-vm", slug: "puru-vm", vmid: 146, node: "squirtle", ip: "192.168.2.100", status: "running", cpu: 8, mem: 15834746880, disk: 0 },
    { key: "utc-app-trafficure", name: "app-trafficure-dev-server", slug: "utc-app-trafficure", vmid: 147, node: "squirtle", ip: "192.168.2.51", status: "running", cpu: 16, mem: 29863038976, disk: 0 },
    { key: "parth-vm", name: "parth-vm", slug: "parth-vm", vmid: 148, node: "squirtle", ip: "192.168.2.93", status: "running", cpu: 8, mem: 16181796864, disk: 0 },
    { key: "clickstack-lepton-api-stopped", name: "clickstack-lepton-api", slug: "clickstack-lepton-api-149", vmid: 149, node: "pikachu", ip: null, status: "stopped", cpu: 12, mem: 0, disk: 0 },
    { key: "clickstack-lepton-api", name: "clickstack-lepton-api", slug: "clickstack-lepton-api", vmid: 150, node: "pikachu", ip: null, status: "running", cpu: 4, mem: 7909044224, disk: 0 },
    // Non-Proxmox VMs (bare metal / external)
    { key: "lepton-59", name: "lepton-59", slug: "lepton-59", vmid: null, node: null, ip: "192.168.1.59", status: "running", cpu: 52, mem: 274877906944, disk: 9895604649984 },
    { key: "samsung-smart-market-prod", name: "samsung-smart-market-prod", slug: "samsung-smart-market-prod", vmid: null, node: null, ip: null, status: "running", cpu: 2, mem: 2147483648, disk: 0, hostKey: "samsung-smart-market-prod" },
  ];

  await db.insert(s.vm).values(
    vms.map((v) => ({
      vmId: id("vm", v.key, "vm"),
      name: v.name,
      slug: v.slug,
      providerId: id("prv", v.node ? "lepton" : (v as any).hostKey === "samsung-smart-market-prod" ? "samsung" : "lepton", "prv"),
      datacenterId: v.node ? id("dc", "lepton-dc", "dc") : null,
      hostId: v.node ? id("host", nodeToHost[v.node], "host") : (v as any).hostKey ? id("host", (v as any).hostKey, "host") : null,
      vmClusterId: v.node ? id("vmc", "lepton-dc", "vmc") : null,
      externalVmid: v.vmid ?? null,
      cpu: v.cpu,
      memoryMb: v.mem > 0 ? bToMb(v.mem) : 0,
      diskGb: v.disk > 0 ? bToGb(v.disk) : 0,
      ipAddress: v.ip,
      status: v.status,
      osType: (v as any).os ?? "linux",
      accessMethod: (v as any).os === "windows" ? "rdp" : "ssh",
    }))
  );

  // --- Subnets ---
  await db.insert(s.subnet).values([
    { subnetId: id("sub", "mgmt", "sub"), cidr: "192.168.1.0/24", gateway: "192.168.1.1", netmask: "255.255.255.0", datacenterId: id("dc", "lepton-dc", "dc"), subnetType: "management", description: "Management / Proxmox node network" },
    { subnetId: id("sub", "vm", "sub"), cidr: "192.168.2.0/24", gateway: "192.168.2.1", netmask: "255.255.255.0", datacenterId: id("dc", "lepton-dc", "dc"), subnetType: "vm", description: "VM network" },
  ]);

  // --- IP Addresses (hosts + running VMs with IPs) ---
  const ipEntries: { address: string; assignedToType: string; assignedToId: string; hostname: string; subnet: string }[] = [
    // Hosts
    { address: "192.168.1.1", assignedToType: "host", assignedToId: id("host", "lepton-squirtle", "host"), hostname: "lepton-squirtle", subnet: "mgmt" },
    { address: "192.168.1.132", assignedToType: "host", assignedToId: id("host", "lepton-pikachu", "host"), hostname: "lepton-pikachu", subnet: "mgmt" },
    { address: "192.168.1.70", assignedToType: "host", assignedToId: id("host", "lepton-charmander", "host"), hostname: "lepton-charmander", subnet: "mgmt" },
    { address: "192.168.1.59", assignedToType: "host", assignedToId: id("host", "lepton-59", "host"), hostname: "lepton-59", subnet: "mgmt" },
  ];

  // Add VM IPs (deduplicate — prefer running VMs over stopped ones)
  const seenIps = new Set(ipEntries.map((e) => e.address));
  // Sort: running first so they win dedup
  const sortedVms = [...vms].sort((a, b) => (a.status === "running" ? -1 : 1) - (b.status === "running" ? -1 : 1));
  for (const v of sortedVms) {
    if (v.ip && v.ip.startsWith("192.168.") && !seenIps.has(v.ip)) {
      seenIps.add(v.ip);
      ipEntries.push({ address: v.ip, assignedToType: "vm", assignedToId: id("vm", v.key, "vm"), hostname: v.slug, subnet: v.ip.startsWith("192.168.1.") ? "mgmt" : "vm" });
    }
  }

  await db.insert(s.ipAddress).values(
    ipEntries.map((e) => ({
      address: e.address,
      subnetId: id("sub", e.subnet, "sub"),
      assignedToType: e.assignedToType as any,
      assignedToId: e.assignedToId,
      status: "assigned" as const,
      hostname: e.hostname,
    }))
  );
}

// ── Phase 3: Product ─────────────────────────────────────────────

// Define products with their modules and components up-front so
// other phases (catalog, build, fleet) can reference them.

interface ComponentDef {
  key: string;
  name: string;
  kind: "server" | "worker" | "task" | "scheduled" | "site" | "database" | "gateway";
  port?: number;
  isPublic?: boolean;
  stateful?: boolean;
  cpu?: string;
  mem?: string;
  replicas?: number;
}

interface ModuleDef {
  key: string;
  name: string;
  product: string;
  team: string;
  components: ComponentDef[];
}

const MODULES: ModuleDef[] = [
  // ── Network Access ──
  { key: "na-core-api", name: "Network Access Core API", product: "network-access", team: "network-access", components: [
    { key: "na-core-api-svc", name: "core-api", kind: "server", port: 8080, cpu: "500m", mem: "512Mi", replicas: 3 },
  ]},
  { key: "na-web-ui", name: "Network Access Web UI", product: "network-access", team: "network-access", components: [
    { key: "na-web-ui-site", name: "web-ui", kind: "site", port: 3000, isPublic: true },
  ]},
  { key: "na-auth-service", name: "Network Access Auth Service", product: "network-access", team: "network-access", components: [
    { key: "na-auth-svc", name: "auth-service", kind: "server", port: 8081 },
  ]},
  { key: "na-network-controller", name: "Network Access Controller", product: "network-access", team: "network-access", components: [
    { key: "na-ctrl-worker", name: "network-controller", kind: "worker", cpu: "250m", mem: "256Mi" },
  ]},
  { key: "na-device-manager", name: "Network Access Device Manager", product: "network-access", team: "network-access", components: [
    { key: "na-device-svc", name: "device-manager", kind: "server", port: 8082 },
  ]},
  // ── Network Access - Verizon Fork ──
  { key: "na-verizon-vpn", name: "Network Access Verizon VPN Module", product: "network-access", team: "network-access", components: [
    { key: "na-vz-vpn-svc", name: "verizon-vpn-gateway", kind: "server", port: 8090 },
    { key: "na-vz-vpn-worker", name: "verizon-vpn-sync", kind: "worker" },
  ]},

  // ── Smart Inventory ──
  { key: "si-inventory-api", name: "Smart Inventory API", product: "smart-inventory", team: "smart-inventory", components: [
    { key: "si-api-svc", name: "inventory-api", kind: "server", port: 8080, cpu: "500m", mem: "512Mi", replicas: 2 },
  ]},
  { key: "si-inventory-ui", name: "Smart Inventory UI", product: "smart-inventory", team: "smart-inventory", components: [
    { key: "si-ui-site", name: "inventory-ui", kind: "site", port: 3000, isPublic: true },
  ]},
  { key: "si-barcode-service", name: "Smart Inventory Barcode Service", product: "smart-inventory", team: "smart-inventory", components: [
    { key: "si-barcode-worker", name: "barcode-scanner", kind: "worker" },
  ]},
  { key: "si-warehouse-manager", name: "Smart Inventory Warehouse Manager", product: "smart-inventory", team: "smart-inventory", components: [
    { key: "si-warehouse-svc", name: "warehouse-manager", kind: "server", port: 8081, stateful: true },
  ]},
  // ── Smart Inventory - Walmart Fork ──
  { key: "si-walmart-pos", name: "Smart Inventory Walmart POS Integration", product: "smart-inventory", team: "smart-inventory", components: [
    { key: "si-wm-pos-svc", name: "walmart-pos-bridge", kind: "server", port: 8092 },
    { key: "si-wm-pos-sync", name: "walmart-pos-sync", kind: "scheduled" },
  ]},

  // ── SmartOps ──
  { key: "so-ops-api", name: "SmartOps API", product: "smartops", team: "smartops", components: [
    { key: "so-api-svc", name: "ops-api", kind: "server", port: 8080, cpu: "500m", mem: "512Mi", replicas: 2 },
  ]},
  { key: "so-ops-ui", name: "SmartOps UI", product: "smartops", team: "smartops", components: [
    { key: "so-ui-site", name: "ops-ui", kind: "site", port: 3000, isPublic: true },
  ]},
  { key: "so-monitoring-agent", name: "SmartOps Monitoring Agent", product: "smartops", team: "smartops", components: [
    { key: "so-mon-worker", name: "monitoring-agent", kind: "worker", cpu: "100m", mem: "128Mi" },
  ]},
  { key: "so-alert-manager", name: "SmartOps Alert Manager", product: "smartops", team: "smartops", components: [
    { key: "so-alert-svc", name: "alert-manager", kind: "server", port: 8081 },
  ]},
  // ── SmartOps - BMW Fork ──
  { key: "so-bmw-telemetry", name: "SmartOps BMW Telemetry", product: "smartops", team: "smartops", components: [
    { key: "so-bmw-tel-worker", name: "bmw-telemetry-collector", kind: "worker" },
    { key: "so-bmw-tel-svc", name: "bmw-telemetry-api", kind: "server", port: 8093 },
  ]},

  // ── Smart Signal ──
  { key: "ss-signal-api", name: "Smart Signal API", product: "smart-signal", team: "smart-signal", components: [
    { key: "ss-api-svc", name: "signal-api", kind: "server", port: 8080, cpu: "1000m", mem: "1Gi", replicas: 3 },
  ]},
  { key: "ss-signal-ui", name: "Smart Signal UI", product: "smart-signal", team: "smart-signal", components: [
    { key: "ss-ui-site", name: "signal-ui", kind: "site", port: 3000, isPublic: true },
  ]},
  { key: "ss-data-collector", name: "Smart Signal Data Collector", product: "smart-signal", team: "smart-signal", components: [
    { key: "ss-collector-worker", name: "data-collector", kind: "worker", cpu: "500m", mem: "512Mi" },
  ]},
  { key: "ss-analytics-engine", name: "Smart Signal Analytics Engine", product: "smart-signal", team: "smart-signal", components: [
    { key: "ss-analytics-svc", name: "analytics-engine", kind: "server", port: 8081, cpu: "2000m", mem: "2Gi", stateful: true },
  ]},

  // ── SmartMarket ──
  { key: "sm-market-api", name: "SmartMarket API", product: "smartmarket", team: "smartmarket", components: [
    { key: "sm-api-svc", name: "market-api", kind: "server", port: 8080, cpu: "500m", mem: "512Mi", replicas: 2 },
  ]},
  { key: "sm-market-ui", name: "SmartMarket UI", product: "smartmarket", team: "smartmarket", components: [
    { key: "sm-ui-site", name: "market-ui", kind: "site", port: 3000, isPublic: true },
  ]},
  { key: "sm-payment-service", name: "SmartMarket Payment Service", product: "smartmarket", team: "smartmarket", components: [
    { key: "sm-pay-svc", name: "payment-service", kind: "server", port: 8081, cpu: "250m", mem: "256Mi" },
  ]},
  { key: "sm-catalog-service", name: "SmartMarket Catalog Service", product: "smartmarket", team: "smartmarket", components: [
    { key: "sm-cat-svc", name: "catalog-service", kind: "server", port: 8082, stateful: true },
  ]},

  // ── Trafficure ──
  { key: "tf-traffic-api", name: "Trafficure API", product: "trafficure", team: "trafficure", components: [
    { key: "tf-api-svc", name: "traffic-api", kind: "server", port: 8080, cpu: "500m", mem: "512Mi", replicas: 2 },
  ]},
  { key: "tf-traffic-ui", name: "Trafficure UI", product: "trafficure", team: "trafficure", components: [
    { key: "tf-ui-site", name: "traffic-ui", kind: "site", port: 3000, isPublic: true },
  ]},
  { key: "tf-traffic-controller", name: "Trafficure Controller", product: "trafficure", team: "trafficure", components: [
    { key: "tf-ctrl-worker", name: "traffic-controller", kind: "worker", cpu: "500m", mem: "512Mi" },
  ]},
  { key: "tf-camera-integration", name: "Trafficure Camera Integration", product: "trafficure", team: "trafficure", components: [
    { key: "tf-cam-worker", name: "camera-integration", kind: "worker", cpu: "1000m", mem: "1Gi" },
  ]},

  // ── Neo360 (Samsung) ──
  { key: "n3-neo360-api", name: "Neo360 API", product: "neo360", team: "neo360", components: [
    { key: "n3-api-svc", name: "neo360-api", kind: "server", port: 8080, cpu: "500m", mem: "512Mi", replicas: 2 },
  ]},
  { key: "n3-neo360-ui", name: "Neo360 UI", product: "neo360", team: "neo360", components: [
    { key: "n3-ui-site", name: "neo360-ui", kind: "site", port: 3000, isPublic: true },
  ]},
  { key: "n3-device-sync", name: "Neo360 Device Sync", product: "neo360", team: "neo360", components: [
    { key: "n3-sync-worker", name: "device-sync", kind: "worker" },
  ]},
  { key: "n3-firmware-manager", name: "Neo360 Firmware Manager", product: "neo360", team: "neo360", components: [
    { key: "n3-fw-svc", name: "firmware-manager", kind: "server", port: 8081, stateful: true },
  ]},
];

async function seedProduct() {
  // --- Modules ---
  await db.insert(s.productModule).values(
    MODULES.map((m) => ({
      moduleId: id("mod", m.key, "mod"),
      name: m.name,
      slug: m.key,
      teamId: id("team", m.team, "team"),
      product: m.product,
      description: `${m.name} module`,
    }))
  );

  // --- Component Specs ---
  const allComponents = MODULES.flatMap((m) =>
    m.components.map((c) => ({
      componentId: id("cmp", c.key, "cmp"),
      moduleId: id("mod", m.key, "mod"),
      name: c.name,
      slug: c.key,
      kind: c.kind,
      isPublic: c.isPublic ?? false,
      stateful: c.stateful ?? false,
      defaultReplicas: c.replicas ?? 1,
      defaultCpu: c.cpu ?? "100m",
      defaultMemory: c.mem ?? "128Mi",
      ports: c.port ? [{ name: "http", containerPort: c.port, protocol: "TCP" }] : [],
      healthcheck: c.port ? { path: "/health", port: c.port, intervalSeconds: 10 } : null,
      description: `${c.name} component`,
    }))
  );

  await db.insert(s.componentSpec).values(allComponents);

  // --- Work Tracker Provider ---
  await db.insert(s.workTrackerProvider).values([
    { workTrackerProviderId: id("wtp", "jira", "wtp"), name: "Lepton Jira", slug: "lepton-jira", kind: "jira", apiUrl: "https://lepton.atlassian.net", defaultProjectKey: "LEP" },
    { workTrackerProviderId: id("wtp", "linear", "wtp"), name: "Lepton Linear", slug: "lepton-linear", kind: "linear", apiUrl: "https://api.linear.app" },
  ]);

  // --- Work Tracker Project Mappings ---
  const jiraMappings = ["na-core-api", "si-inventory-api", "so-ops-api", "ss-signal-api", "tf-traffic-api", "n3-neo360-api"].map((modKey, i) => ({
    workTrackerProviderId: id("wtp", "jira", "wtp"),
    moduleId: id("mod", modKey, "mod"),
    externalProjectId: `10${i}00`,
    externalProjectName: modKey.toUpperCase().replace(/-/g, "_"),
    syncDirection: "bidirectional" as const,
  }));

  await db.insert(s.workTrackerProjectMapping).values(jiraMappings);

  // --- Work Items ---
  const workItems = [
    { mod: "na-core-api", title: "Implement RADIUS authentication flow", status: "done", kind: "story", priority: "high", assignee: "maria-garcia" },
    { mod: "na-core-api", title: "Network device auto-discovery", status: "in_progress", kind: "epic", priority: "high", assignee: "james-wilson" },
    { mod: "na-core-api", title: "Fix timeout on large device lists", status: "in_review", kind: "bug", priority: "critical" as string, assignee: "maria-garcia" },
    { mod: "si-inventory-api", title: "Barcode batch scanning API", status: "ready", kind: "story", priority: "medium", assignee: "sarah-johnson" },
    { mod: "si-inventory-api", title: "Warehouse zone mapping", status: "in_progress", kind: "story", priority: "medium", assignee: "david-kim" },
    { mod: "so-ops-api", title: "Alert rule engine v2", status: "in_progress", kind: "epic", priority: "high", assignee: "lisa-wang" },
    { mod: "so-ops-api", title: "Grafana dashboard integration", status: "backlog", kind: "story", priority: "low", assignee: "mike-brown" },
    { mod: "ss-signal-api", title: "Real-time signal processing pipeline", status: "in_progress", kind: "epic", priority: "high", assignee: "emma-davis" },
    { mod: "tf-traffic-api", title: "Camera feed health monitoring", status: "ready", kind: "story", priority: "medium", assignee: "ana-martinez" },
    { mod: "n3-neo360-api", title: "Samsung Knox integration", status: "in_progress", kind: "story", priority: "high", assignee: "kenji-tanaka" },
    { mod: "n3-firmware-manager", title: "OTA firmware update rollback", status: "backlog", kind: "story", priority: "medium", assignee: "yuki-sato" },
    { mod: "na-verizon-vpn", title: "Verizon VPN gateway HA failover", status: "in_progress", kind: "story", priority: "critical" as string, assignee: "james-wilson" },
    { mod: "si-walmart-pos", title: "POS transaction sync latency fix", status: "in_review", kind: "bug", priority: "high", assignee: "david-kim" },
    { mod: "so-bmw-telemetry", title: "BMW CAN bus data parser", status: "in_progress", kind: "task", priority: "high", assignee: "mike-brown" },
  ];

  await db.insert(s.workItem).values(
    workItems.map((wi) => ({
      moduleId: id("mod", wi.mod, "mod"),
      title: wi.title,
      status: wi.status,
      kind: wi.kind,
      priority: wi.priority,
      assignee: wi.assignee,
    }))
  );
}

// ── Phase 4: Catalog ─────────────────────────────────────────────

async function seedCatalog() {
  const products = ["network-access", "smart-inventory", "smartops", "smart-signal", "smartmarket", "trafficure", "neo360"];
  const productTeamMap: Record<string, string> = {
    "network-access": "network-access",
    "smart-inventory": "smart-inventory",
    "smartops": "smartops",
    "smart-signal": "smart-signal",
    "smartmarket": "smartmarket",
    "trafficure": "trafficure",
    "neo360": "neo360",
  };

  // --- Catalog Domains (one per product) ---
  await db.insert(s.catalogDomain).values(
    products.map((p) => ({
      domainId: id("cdom", p, "cdom"),
      name: p,
      title: p.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
      description: `${p} product domain`,
      ownerTeamId: id("team", productTeamMap[p], "team"),
    }))
  );

  // --- Catalog Systems (one per module) ---
  await db.insert(s.catalogSystem).values(
    MODULES.map((m) => ({
      systemId: id("csys", m.key, "csys"),
      name: m.key,
      title: m.name,
      description: `${m.name} system`,
      ownerTeamId: id("team", m.team, "team"),
      domainId: id("cdom", m.product, "cdom"),
      lifecycle: "production",
    }))
  );

  // --- Catalog Components ---
  const catalogComponents = MODULES.flatMap((m) =>
    m.components.map((c) => ({
      componentId: id("ccmp", c.key, "ccmp"),
      systemId: id("csys", m.key, "csys"),
      name: c.key,
      title: c.name,
      description: `${c.name} catalog component`,
      type: c.kind === "site" ? ("website" as const) : c.kind === "worker" || c.kind === "scheduled" ? ("worker" as const) : ("service" as const),
      ownerTeamId: id("team", m.team, "team"),
      isPublic: c.isPublic ?? false,
      stateful: c.stateful ?? false,
      ports: c.port ? [{ name: "http", containerPort: c.port, protocol: "TCP" }] : [],
    }))
  );

  await db.insert(s.catalogComponent).values(catalogComponents);

  // --- Catalog Resources (DB + cache per product) ---
  const resources = products.flatMap((p) => [
    {
      resourceId: id("cres", `${p}-db`, "cres"),
      systemId: id("csys", MODULES.find((m) => m.product === p && m.key.includes("api"))!.key, "csys"),
      name: `${p}-db`,
      title: `${p} PostgreSQL`,
      type: "database" as const,
      ownerTeamId: id("team", productTeamMap[p], "team"),
      image: "postgres:16-alpine",
      containerPort: 5432,
    },
    {
      resourceId: id("cres", `${p}-cache`, "cres"),
      systemId: id("csys", MODULES.find((m) => m.product === p && m.key.includes("api"))!.key, "csys"),
      name: `${p}-cache`,
      title: `${p} Redis`,
      type: "cache" as const,
      ownerTeamId: id("team", productTeamMap[p], "team"),
      image: "redis:7-alpine",
      containerPort: 6379,
    },
  ]);

  await db.insert(s.catalogResource).values(resources);

  // --- Catalog APIs ---
  const apis = MODULES
    .filter((m) => m.components.some((c) => c.kind === "server"))
    .map((m) => {
      const svc = m.components.find((c) => c.kind === "server")!;
      return {
        apiId: id("capi", m.key, "capi"),
        systemId: id("csys", m.key, "csys"),
        name: `${m.key}-api`,
        title: `${m.name} REST API`,
        type: "openapi" as const,
        ownerTeamId: id("team", m.team, "team"),
        providedByComponentId: id("ccmp", svc.key, "ccmp"),
        definition: `openapi: 3.0.0\ninfo:\n  title: ${m.name}\n  version: 1.0.0\npaths: {}`,
      };
    });

  await db.insert(s.catalogApi).values(apis);

  // --- Entity Links (catalog <-> product) ---
  const entityLinks = [
    ...MODULES.map((m) => ({
      catalogEntityKind: "System" as const,
      catalogEntityId: id("csys", m.key, "csys"),
      factorySchema: "factory_product",
      factoryTable: "module",
      factoryEntityId: id("mod", m.key, "mod"),
    })),
  ];

  await db.insert(s.catalogEntityLink).values(entityLinks);
}

// ── Phase 5: Build ───────────────────────────────────────────────

async function seedBuild() {
  // --- Git Host Providers ---
  await db.insert(s.gitHostProvider).values([
    { gitHostProviderId: id("ghp", "github", "ghp"), name: "Lepton GitHub", slug: "lepton-github", hostType: "github", apiBaseUrl: "https://api.github.com", authMode: "github_app", teamId: id("team", "devex", "team") },
    { gitHostProviderId: id("ghp", "gitea", "ghp"), name: "Lepton Gitea", slug: "lepton-gitea", hostType: "gitea", apiBaseUrl: "https://git.lepton.internal", authMode: "pat", teamId: id("team", "devex", "team") },
  ]);

  // --- Repos (one per module) ---
  await db.insert(s.repo).values(
    MODULES.map((m) => ({
      repoId: id("repo", m.key, "repo"),
      name: m.key,
      slug: m.key,
      kind: m.key.includes("verizon") || m.key.includes("walmart") || m.key.includes("bmw") ? ("client-project" as const) : ("product-module" as const),
      moduleId: id("mod", m.key, "mod"),
      gitHostProviderId: id("ghp", "github", "ghp"),
      teamId: id("team", m.team, "team"),
      gitUrl: `https://github.com/lepton-ai/${m.key}.git`,
      defaultBranch: "main",
    }))
  );

  // Platform repos
  const platformRepos = [
    { key: "factory-infra", name: "factory-infra", team: "infra", kind: "infra" as const },
    { key: "factory-docs", name: "factory-docs", team: "devex", kind: "docs" as const },
    { key: "dx-cli", name: "dx-cli", team: "devex", kind: "tool" as const },
  ];

  await db.insert(s.repo).values(
    platformRepos.map((r) => ({
      repoId: id("repo", r.key, "repo"),
      name: r.name,
      slug: r.key,
      kind: r.kind,
      gitHostProviderId: id("ghp", "github", "ghp"),
      teamId: id("team", r.team, "team"),
      gitUrl: `https://github.com/lepton-ai/${r.key}.git`,
      defaultBranch: "main",
    }))
  );

  // --- Module Versions ---
  const versionSets = MODULES.map((m) => [
    { key: `${m.key}-v1.0.0`, moduleId: id("mod", m.key, "mod"), version: "1.0.0" },
    { key: `${m.key}-v1.1.0`, moduleId: id("mod", m.key, "mod"), version: "1.1.0" },
    { key: `${m.key}-v1.2.0-rc1`, moduleId: id("mod", m.key, "mod"), version: "1.2.0-rc1" },
  ]).flat();

  await db.insert(s.moduleVersion).values(
    versionSets.map((v) => ({
      moduleVersionId: id("mv", v.key, "mv"),
      moduleId: v.moduleId,
      version: v.version,
    }))
  );

  // --- Artifacts (latest version per component) ---
  const allComponents = MODULES.flatMap((m) =>
    m.components.map((c) => ({
      modKey: m.key,
      compKey: c.key,
      imageRef: `registry.lepton.ai/${m.product}/${c.name}:1.1.0`,
      imageDigest: `sha256:${c.key.replace(/[^a-z0-9]/g, "")}${"0".repeat(64)}`.slice(0, 71),
    }))
  );

  await db.insert(s.artifact).values(
    allComponents.map((a) => ({
      artifactId: id("art", a.compKey, "art"),
      kind: "container_image" as const,
      imageRef: a.imageRef,
      imageDigest: a.imageDigest,
      sizeBytes: Math.floor(Math.random() * 500_000_000) + 50_000_000,
    }))
  );

  // --- Component Artifacts (link version -> component -> artifact) ---
  await db.insert(s.componentArtifact).values(
    allComponents.map((a) => ({
      moduleVersionId: id("mv", `${a.modKey}-v1.1.0`, "mv"),
      componentId: id("cmp", a.compKey, "cmp"),
      artifactId: id("art", a.compKey, "art"),
    }))
  );

  // --- GitHub App Installation ---
  await db.insert(s.githubAppInstallation).values([{
    gitHostProviderId: id("ghp", "github", "ghp"),
    githubAppId: "123456",
    githubInstallationId: "78901234",
    privateKeyEnc: "enc:vault:github-app-key",
    webhookSecret: "enc:vault:github-webhook-secret",
    permissionsGranted: { contents: "write", pull_requests: "write", checks: "write" },
    accountLogin: "lepton-ai",
    accountType: "Organization",
  }]);

  // --- Git Repo Syncs ---
  await db.insert(s.gitRepoSync).values(
    MODULES.slice(0, 10).map((m, i) => ({
      repoId: id("repo", m.key, "repo"),
      gitHostProviderId: id("ghp", "github", "ghp"),
      externalRepoId: `${500000 + i}`,
      externalFullName: `lepton-ai/${m.key}`,
    }))
  );
}

// ── Phase 6: Commerce ────────────────────────────────────────────

async function seedCommerce() {
  // --- Customers ---
  const customers = [
    { key: "verizon", name: "Verizon", status: "active" },
    { key: "t-mobile", name: "T-Mobile", status: "active" },
    { key: "att", name: "AT&T", status: "active" },
    { key: "vodafone", name: "Vodafone", status: "active" },
    { key: "walmart", name: "Walmart", status: "active" },
    { key: "target", name: "Target", status: "active" },
    { key: "costco", name: "Costco", status: "trial" },
    { key: "bmw", name: "BMW", status: "active" },
    { key: "toyota", name: "Toyota", status: "active" },
    { key: "ford", name: "Ford", status: "trial" },
    { key: "shell", name: "Shell", status: "active" },
    { key: "bp", name: "BP", status: "active" },
    { key: "engie", name: "Engie", status: "trial" },
    { key: "samsung", name: "Samsung", status: "active" },
    { key: "lg", name: "LG", status: "trial" },
    { key: "nyc-dot", name: "NYC Department of Transportation", status: "active" },
    { key: "tfl", name: "Transport for London", status: "active" },
  ];

  await db.insert(s.customerAccount).values(
    customers.map((c) => ({
      customerId: id("cust", c.key, "cust"),
      name: c.name,
      slug: c.key,
      status: c.status,
    }))
  );

  // --- Plans ---
  await db.insert(s.commercePlan).values([
    { planId: id("pln", "standard", "pln"), name: "Standard", slug: "standard", includedModules: [] },
    { planId: id("pln", "enterprise", "pln"), name: "Enterprise", slug: "enterprise", includedModules: [] },
    { planId: id("pln", "custom-dedicated", "pln"), name: "Custom Dedicated", slug: "custom-dedicated", includedModules: [] },
  ]);

  // --- Entitlements (customer -> module mappings) ---
  // Each entry: [customer, module-key, status?]
  const entitlements: [string, string, string?][] = [
    // Telecom - Network Access heavy
    ["verizon", "na-core-api"], ["verizon", "na-web-ui"], ["verizon", "na-auth-service"], ["verizon", "na-network-controller"], ["verizon", "na-device-manager"],
    ["verizon", "na-verizon-vpn"], // fork
    ["verizon", "so-ops-api"], ["verizon", "so-ops-ui"], ["verizon", "so-monitoring-agent"],
    ["t-mobile", "na-core-api"], ["t-mobile", "na-web-ui"], ["t-mobile", "na-auth-service"], ["t-mobile", "na-network-controller"],
    ["t-mobile", "ss-signal-api"], ["t-mobile", "ss-signal-ui"],
    ["att", "na-core-api"], ["att", "na-web-ui"], ["att", "na-auth-service"], ["att", "na-network-controller"], ["att", "na-device-manager"],
    ["vodafone", "na-core-api"], ["vodafone", "na-web-ui"], ["vodafone", "na-auth-service"],
    ["vodafone", "so-ops-api"], ["vodafone", "so-ops-ui"],

    // Retail - Inventory + Market
    ["walmart", "si-inventory-api"], ["walmart", "si-inventory-ui"], ["walmart", "si-barcode-service"], ["walmart", "si-warehouse-manager"],
    ["walmart", "si-walmart-pos"], // fork
    ["walmart", "sm-market-api"], ["walmart", "sm-market-ui"],
    ["target", "si-inventory-api"], ["target", "si-inventory-ui"], ["target", "si-barcode-service"],
    ["target", "sm-market-api"], ["target", "sm-market-ui"], ["target", "sm-payment-service"],
    ["costco", "si-inventory-api"], ["costco", "si-inventory-ui"],

    // Automotive - SmartOps + Signal
    ["bmw", "so-ops-api"], ["bmw", "so-ops-ui"], ["bmw", "so-monitoring-agent"], ["bmw", "so-alert-manager"],
    ["bmw", "so-bmw-telemetry"], // fork
    ["bmw", "ss-signal-api"], ["bmw", "ss-signal-ui"], ["bmw", "ss-data-collector"],
    ["toyota", "so-ops-api"], ["toyota", "so-ops-ui"], ["toyota", "so-monitoring-agent"],
    ["toyota", "ss-signal-api"], ["toyota", "ss-signal-ui"],
    ["ford", "so-ops-api"], ["ford", "so-ops-ui"],

    // Energy
    ["shell", "so-ops-api"], ["shell", "so-ops-ui"], ["shell", "so-monitoring-agent"], ["shell", "so-alert-manager"],
    ["shell", "ss-signal-api"], ["shell", "ss-signal-ui"], ["shell", "ss-data-collector"], ["shell", "ss-analytics-engine"],
    ["bp", "so-ops-api"], ["bp", "so-ops-ui"], ["bp", "so-monitoring-agent"],
    ["bp", "ss-signal-api"], ["bp", "ss-signal-ui"],
    ["engie", "so-ops-api"], ["engie", "so-ops-ui"],

    // Electronics
    ["samsung", "n3-neo360-api"], ["samsung", "n3-neo360-ui"], ["samsung", "n3-device-sync"], ["samsung", "n3-firmware-manager"],
    ["lg", "n3-neo360-api"], ["lg", "n3-neo360-ui"],

    // Government - Trafficure
    ["nyc-dot", "tf-traffic-api"], ["nyc-dot", "tf-traffic-ui"], ["nyc-dot", "tf-traffic-controller"], ["nyc-dot", "tf-camera-integration"],
    ["nyc-dot", "ss-signal-api"], ["nyc-dot", "ss-signal-ui"],
    ["tfl", "tf-traffic-api"], ["tfl", "tf-traffic-ui"], ["tfl", "tf-traffic-controller"], ["tfl", "tf-camera-integration"],
    ["tfl", "ss-signal-api"], ["tfl", "ss-signal-ui"], ["tfl", "ss-data-collector"],
  ];

  await db.insert(s.entitlement).values(
    entitlements.map(([cust, mod, status]) => ({
      customerId: id("cust", cust, "cust"),
      moduleId: id("mod", mod, "mod"),
      status: status ?? "active",
      quotas: { maxSites: 5, maxUsers: 100 },
    }))
  );

  // --- Entitlement Bundles (for key customers) ---
  const bundleCustomers = ["verizon", "walmart", "bmw", "samsung", "nyc-dot", "tfl", "shell"];
  const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  await db.insert(s.entitlementBundle).values(
    bundleCustomers.map((c) => ({
      customerId: id("cust", c, "cust"),
      siteId: id("site", `${c}-prod`, "site"), // will be created in fleet phase
      payload: { customer: c, modules: entitlements.filter(([cust]) => cust === c).map(([, mod]) => mod), generatedAt: new Date().toISOString() },
      signature: `sig_${c}_${Date.now()}`,
      expiresAt: futureDate,
    }))
  );
}

// ── Phase 7: Fleet ───────────────────────────────────────────────

async function seedFleet() {
  // --- Sites ---
  const sites = [
    { key: "verizon-prod", name: "Verizon US East", product: "network-access", cls: "site-us-east-prod", status: "active" },
    { key: "verizon-west", name: "Verizon US West", product: "network-access", cls: "site-us-west-prod", status: "active" },
    { key: "t-mobile-prod", name: "T-Mobile US East", product: "network-access", cls: "site-us-east-prod", status: "active" },
    { key: "att-prod", name: "AT&T US East", product: "network-access", cls: "site-us-east-prod", status: "active" },
    { key: "vodafone-prod", name: "Vodafone EU Frankfurt", product: "network-access", cls: "site-eu-fra-prod", status: "active" },
    { key: "walmart-prod", name: "Walmart US East", product: "smart-inventory", cls: "site-us-east-prod", status: "active" },
    { key: "walmart-west", name: "Walmart US West", product: "smart-inventory", cls: "site-us-west-prod", status: "active" },
    { key: "target-prod", name: "Target US East", product: "smart-inventory", cls: "site-us-east-prod", status: "active" },
    { key: "costco-trial", name: "Costco Trial", product: "smart-inventory", cls: "site-us-east-staging", status: "provisioning" },
    { key: "bmw-prod", name: "BMW EU Frankfurt", product: "smartops", cls: "site-eu-fra-prod", status: "active" },
    { key: "toyota-prod", name: "Toyota APAC Singapore", product: "smartops", cls: "site-apac-sg-prod", status: "active" },
    { key: "ford-trial", name: "Ford Trial", product: "smartops", cls: "site-us-east-staging", status: "provisioning" },
    { key: "shell-prod", name: "Shell EU Frankfurt", product: "smartops", cls: "site-eu-fra-prod", status: "active" },
    { key: "bp-prod", name: "BP EU Frankfurt", product: "smartops", cls: "site-eu-fra-prod", status: "active" },
    { key: "samsung-prod", name: "Samsung APAC Singapore", product: "neo360", cls: "site-apac-sg-prod", status: "active" },
    { key: "nyc-dot-prod", name: "NYC DOT US East", product: "trafficure", cls: "site-us-east-prod", status: "active" },
    { key: "tfl-prod", name: "TfL EU Frankfurt", product: "trafficure", cls: "site-eu-fra-prod", status: "active" },
    { key: "lg-trial", name: "LG Trial", product: "neo360", cls: "site-apac-sg-prod", status: "provisioning" },
  ];

  await db.insert(s.fleetSite).values(
    sites.map((site) => ({
      siteId: id("site", site.key, "site"),
      name: site.name,
      slug: site.key,
      product: site.product,
      clusterId: id("cls", site.cls, "cls"),
      status: site.status,
      lastCheckinAt: site.status === "active" ? new Date() : null,
      currentManifestVersion: site.status === "active" ? 1 : null,
    }))
  );

  // --- Releases ---
  await db.insert(s.release).values([
    { releaseId: id("rel", "v2024.1.0", "rel"), version: "v2024.1.0", status: "production", createdBy: id("prin", "alex-chen", "prin") },
    { releaseId: id("rel", "v2024.2.0", "rel"), version: "v2024.2.0", status: "staging", createdBy: id("prin", "alex-chen", "prin") },
    { releaseId: id("rel", "v2024.3.0-rc1", "rel"), version: "v2024.3.0-rc1", status: "draft", createdBy: id("prin", "jake-taylor", "prin") },
  ]);

  // --- Release Module Pins (pin key modules to production release) ---
  const pinnedModules = ["na-core-api", "si-inventory-api", "so-ops-api", "ss-signal-api", "sm-market-api", "tf-traffic-api", "n3-neo360-api"];
  await db.insert(s.releaseModulePin).values(
    pinnedModules.map((modKey) => ({
      releaseId: id("rel", "v2024.1.0", "rel"),
      moduleVersionId: id("mv", `${modKey}-v1.1.0`, "mv"),
    }))
  );

  // Staging release pins the rc versions
  await db.insert(s.releaseModulePin).values(
    pinnedModules.map((modKey) => ({
      releaseId: id("rel", "v2024.2.0", "rel"),
      moduleVersionId: id("mv", `${modKey}-v1.2.0-rc1`, "mv"),
    }))
  );

  // --- Deployment Targets ---
  // Production targets for active sites
  const activeSites = sites.filter((s) => s.status === "active");
  const prodTargets = activeSites.map((site) => ({
    deploymentTargetId: id("dt", `${site.key}-prod`, "dt"),
    name: `${site.name} Production`,
    slug: `${site.key}-prod`,
    kind: "production" as const,
    siteId: id("site", site.key, "site"),
    clusterId: id("cls", site.cls, "cls"),
    namespace: `${site.key}-prod`,
    createdBy: id("prin", "deploy-bot", "prin"),
    trigger: "release" as const,
    status: "active" as const,
    labels: { customer: site.key.split("-")[0], product: site.product },
  }));

  await db.insert(s.deploymentTarget).values(prodTargets);

  // Staging targets for a subset
  const stagingSites = ["verizon-prod", "walmart-prod", "bmw-prod", "samsung-prod"];
  const stagingTargets = stagingSites.map((siteKey) => ({
    deploymentTargetId: id("dt", `${siteKey}-staging`, "dt"),
    name: `${sites.find((s) => s.key === siteKey)!.name} Staging`,
    slug: `${siteKey}-staging`,
    kind: "staging" as const,
    siteId: id("site", siteKey, "site"),
    clusterId: id("cls", sites.find((s) => s.key === siteKey)!.cls, "cls"),
    namespace: `${siteKey}-staging`,
    createdBy: id("prin", "deploy-bot", "prin"),
    trigger: "release" as const,
    status: "active" as const,
  }));

  await db.insert(s.deploymentTarget).values(stagingTargets);

  // Dev sandbox targets
  await db.insert(s.deploymentTarget).values([
    { deploymentTargetId: id("dt", "dev-sandbox-maria", "dt"), name: "Maria Dev Sandbox", slug: "dev-sandbox-maria", kind: "sandbox", clusterId: id("cls", "dev-sandbox", "cls"), namespace: "sandbox-maria", createdBy: id("prin", "maria-garcia", "prin"), trigger: "manual", status: "active" },
    { deploymentTargetId: id("dt", "dev-sandbox-kenji", "dt"), name: "Kenji Dev Sandbox", slug: "dev-sandbox-kenji", kind: "sandbox", clusterId: id("cls", "dev-sandbox", "cls"), namespace: "sandbox-kenji", createdBy: id("prin", "kenji-tanaka", "prin"), trigger: "manual", status: "active" },
  ]);

  // Preview targets
  await db.insert(s.deploymentTarget).values([
    { deploymentTargetId: id("dt", "preview-na-feat-radius", "dt"), name: "Preview: NA RADIUS Auth", slug: "preview-na-feat-radius", kind: "preview", clusterId: id("cls", "dev-sandbox", "cls"), namespace: "preview-na-radius", createdBy: id("prin", "ci-bot", "prin"), trigger: "pr", status: "active", expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    { deploymentTargetId: id("dt", "preview-so-alert-v2", "dt"), name: "Preview: SO Alert v2", slug: "preview-so-alert-v2", kind: "preview", clusterId: id("cls", "dev-sandbox", "cls"), namespace: "preview-so-alert", createdBy: id("prin", "ci-bot", "prin"), trigger: "pr", status: "active", expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    { deploymentTargetId: id("dt", "preview-n3-knox", "dt"), name: "Preview: N3 Knox Integration", slug: "preview-n3-knox", kind: "preview", clusterId: id("cls", "dev-sandbox", "cls"), namespace: "preview-n3-knox", createdBy: id("prin", "ci-bot", "prin"), trigger: "pr", status: "active", expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  ]);

  // --- Workloads (a representative subset for key sites) ---
  // Verizon production: NA modules
  const verizonModules = ["na-core-api", "na-web-ui", "na-auth-service", "na-network-controller", "na-device-manager", "na-verizon-vpn"];
  const workloadData: { dt: string; modKey: string; compKey: string }[] = [];

  for (const modKey of verizonModules) {
    const mod = MODULES.find((m) => m.key === modKey)!;
    for (const comp of mod.components) {
      workloadData.push({ dt: "verizon-prod-prod", modKey, compKey: comp.key });
    }
  }

  // Samsung production: Neo360 modules
  const samsungModules = ["n3-neo360-api", "n3-neo360-ui", "n3-device-sync", "n3-firmware-manager"];
  for (const modKey of samsungModules) {
    const mod = MODULES.find((m) => m.key === modKey)!;
    for (const comp of mod.components) {
      workloadData.push({ dt: "samsung-prod-prod", modKey, compKey: comp.key });
    }
  }

  // NYC DOT: Trafficure modules
  const nycdotModules = ["tf-traffic-api", "tf-traffic-ui", "tf-traffic-controller", "tf-camera-integration"];
  for (const modKey of nycdotModules) {
    const mod = MODULES.find((m) => m.key === modKey)!;
    for (const comp of mod.components) {
      workloadData.push({ dt: "nyc-dot-prod-prod", modKey, compKey: comp.key });
    }
  }

  // BMW production: SmartOps modules
  const bmwModules = ["so-ops-api", "so-ops-ui", "so-monitoring-agent", "so-alert-manager", "so-bmw-telemetry"];
  for (const modKey of bmwModules) {
    const mod = MODULES.find((m) => m.key === modKey)!;
    for (const comp of mod.components) {
      workloadData.push({ dt: "bmw-prod-prod", modKey, compKey: comp.key });
    }
  }

  if (workloadData.length > 0) {
    await db.insert(s.workload).values(
      workloadData.map((w) => ({
        deploymentTargetId: id("dt", w.dt, "dt"),
        moduleVersionId: id("mv", `${w.modKey}-v1.1.0`, "mv"),
        componentId: id("cmp", w.compKey, "cmp"),
        artifactId: id("art", w.compKey, "art"),
        desiredImage: `registry.lepton.ai/${MODULES.find((m) => m.key === w.modKey)!.product}/${MODULES.find((m) => m.key === w.modKey)!.components.find((c) => c.key === w.compKey)!.name}:1.1.0`,
        actualImage: `registry.lepton.ai/${MODULES.find((m) => m.key === w.modKey)!.product}/${MODULES.find((m) => m.key === w.modKey)!.components.find((c) => c.key === w.compKey)!.name}:1.1.0`,
        status: "running",
      }))
    );
  }

  // --- Dependency Workloads (DBs and caches for key targets) ---
  const depTargets = ["verizon-prod-prod", "samsung-prod-prod", "nyc-dot-prod-prod", "bmw-prod-prod"];
  const depWorkloads = depTargets.flatMap((dt) => {
    const siteKey = dt.replace("-prod", "").replace("-prod", "");
    const product = sites.find((s) => s.key === `${siteKey}-prod` || s.key === siteKey)?.product ?? "unknown";
    return [
      { deploymentTargetId: id("dt", dt, "dt"), name: `${product}-postgres`, slug: `${dt}-postgres`, image: "postgres:16-alpine", port: 5432, catalogResourceId: id("cres", `${product}-db`, "cres"), status: "running" as const },
      { deploymentTargetId: id("dt", dt, "dt"), name: `${product}-redis`, slug: `${dt}-redis`, image: "redis:7-alpine", port: 6379, catalogResourceId: id("cres", `${product}-cache`, "cres"), status: "running" as const },
    ];
  });

  await db.insert(s.dependencyWorkload).values(depWorkloads);

  // --- Rollouts ---
  await db.insert(s.rollout).values(
    prodTargets.slice(0, 6).map((t) => ({
      releaseId: id("rel", "v2024.1.0", "rel"),
      deploymentTargetId: t.deploymentTargetId,
      status: "succeeded" as const,
      completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    }))
  );

  // --- Site Manifests ---
  await db.insert(s.siteManifest).values(
    activeSites.slice(0, 5).map((site) => ({
      siteId: id("site", site.key, "site"),
      manifestVersion: 1,
      manifestHash: `hash_${site.key}_v1`,
      releaseId: id("rel", "v2024.1.0", "rel"),
      content: { manifestVersion: 1, routes: [], domains: [], configuration: {} },
    }))
  );

  // --- Install Manifests ---
  await db.insert(s.installManifest).values(
    activeSites.slice(0, 5).map((site) => ({
      siteId: id("site", site.key, "site"),
      dxVersion: "0.5.0",
      k3sVersion: "v1.29.4+k3s1",
      helmChartVersion: "0.8.0",
      siteName: site.name,
      domain: `${site.key}.lepton.network`,
      enabledPlanes: ["control", "data"],
      nodes: [{ role: "server", count: 1 }, { role: "agent", count: 2 }],
    }))
  );

  // --- Release Bundles ---
  await db.insert(s.releaseBundle).values([
    { releaseId: id("rel", "v2024.1.0", "rel"), dxVersion: "0.5.0", k3sVersion: "v1.29.4+k3s1", helmChartVersion: "0.8.0", imageCount: 35, sizeBytes: "4500000000", checksumSha256: "abc123def456", storagePath: "/bundles/v2024.1.0-amd64.tar.zst", status: "ready", createdBy: id("prin", "ci-bot", "prin") },
    { releaseId: id("rel", "v2024.1.0", "rel"), arch: "arm64" as const, dxVersion: "0.5.0", k3sVersion: "v1.29.4+k3s1", helmChartVersion: "0.8.0", imageCount: 35, sizeBytes: "4200000000", storagePath: "/bundles/v2024.1.0-arm64.tar.zst", status: "ready", createdBy: id("prin", "ci-bot", "prin") },
    { releaseId: id("rel", "v2024.2.0", "rel"), dxVersion: "0.6.0-rc1", k3sVersion: "v1.30.1+k3s1", helmChartVersion: "0.9.0", imageCount: 36, storagePath: "/bundles/v2024.2.0-amd64.tar.zst", status: "building", createdBy: id("prin", "ci-bot", "prin") },
  ]);

  // --- Sandbox Templates ---
  await db.insert(s.sandboxTemplate).values([
    { sandboxTemplateId: id("sbt", "default-container", "sbt"), name: "Default Container", slug: "default-container", runtimeType: "container", image: "ghcr.io/lepton-ai/devcontainer:latest", defaultCpu: "4000m", defaultMemory: "8Gi", defaultStorageGb: 50, defaultDockerCacheGb: 20, defaultTtlMinutes: 480, preInstalledTools: ["git", "docker", "kubectl", "node", "go"], isDefault: true },
    { sandboxTemplateId: id("sbt", "gpu-vm", "sbt"), name: "GPU VM", slug: "gpu-vm", runtimeType: "vm", vmTemplateRef: "proxmox:template/gpu-dev-vm", defaultCpu: "8000m", defaultMemory: "32Gi", defaultStorageGb: 200, defaultDockerCacheGb: 50, defaultTtlMinutes: 240, preInstalledTools: ["git", "docker", "nvidia-smi", "python3", "cuda"] },
  ]);

  // --- Sandboxes ---
  await db.insert(s.sandbox).values([
    {
      deploymentTargetId: id("dt", "dev-sandbox-maria", "dt"),
      name: "Maria Network Access Dev",
      slug: "sandbox-maria-na",
      runtimeType: "container",
      podName: "sandbox-maria-na-pod",
      devcontainerImage: "ghcr.io/lepton-ai/devcontainer:latest",
      ownerId: id("prin", "maria-garcia", "prin"),
      ownerType: "user",
      repos: [{ url: "https://github.com/lepton-ai/na-core-api.git", branch: "feat/radius-auth", clonePath: "/workspace/na-core-api" }],
      cpu: "4000m",
      memory: "8Gi",
      storageGb: 50,
      sshHost: "sandbox.lepton.internal",
      sshPort: 2222,
    },
    {
      deploymentTargetId: id("dt", "dev-sandbox-kenji", "dt"),
      name: "Kenji Neo360 Dev",
      slug: "sandbox-kenji-n3",
      runtimeType: "container",
      podName: "sandbox-kenji-n3-pod",
      devcontainerImage: "ghcr.io/lepton-ai/devcontainer:latest",
      ownerId: id("prin", "kenji-tanaka", "prin"),
      ownerType: "user",
      repos: [{ url: "https://github.com/lepton-ai/n3-neo360-api.git", branch: "feat/knox-integration", clonePath: "/workspace/n3-neo360-api" }],
      cpu: "4000m",
      memory: "8Gi",
      storageGb: 50,
      sshHost: "sandbox.lepton.internal",
      sshPort: 2223,
    },
  ]);

  // --- Previews ---
  await db.insert(s.preview).values([
    {
      deploymentTargetId: id("dt", "preview-na-feat-radius", "dt"),
      siteId: id("site", "verizon-prod", "site"),
      name: "NA RADIUS Auth Preview",
      slug: "preview-na-radius-42",
      sourceBranch: "feat/radius-auth",
      commitSha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      repo: "lepton-ai/na-core-api",
      prNumber: 42,
      ownerId: id("prin", "maria-garcia", "prin"),
      status: "active",
    },
    {
      deploymentTargetId: id("dt", "preview-so-alert-v2", "dt"),
      siteId: id("site", "bmw-prod", "site"),
      name: "SO Alert v2 Preview",
      slug: "preview-so-alert-v2-87",
      sourceBranch: "feat/alert-engine-v2",
      commitSha: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1",
      repo: "lepton-ai/so-ops-api",
      prNumber: 87,
      ownerId: id("prin", "lisa-wang", "prin"),
      status: "active",
    },
    {
      deploymentTargetId: id("dt", "preview-n3-knox", "dt"),
      siteId: id("site", "samsung-prod", "site"),
      name: "N3 Knox Integration Preview",
      slug: "preview-n3-knox-156",
      sourceBranch: "feat/knox-integration",
      commitSha: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
      repo: "lepton-ai/n3-neo360-api",
      prNumber: 156,
      ownerId: id("prin", "kenji-tanaka", "prin"),
      status: "deploying",
    },
  ]);
}

// ── Phase 8: Gateway ─────────────────────────────────────────────

async function seedGateway() {
  // --- Routes ---
  const routeData = [
    // Verizon production
    { key: "rte-vz-api", site: "verizon-prod", dt: "verizon-prod-prod", kind: "ingress", domain: "api.verizon.lepton.network", pathPrefix: "/api", targetService: "na-core-api-svc", targetPort: 8080 },
    { key: "rte-vz-web", site: "verizon-prod", dt: "verizon-prod-prod", kind: "ingress", domain: "verizon.lepton.network", targetService: "na-web-ui-site", targetPort: 3000 },
    // Samsung production
    { key: "rte-sam-api", site: "samsung-prod", dt: "samsung-prod-prod", kind: "ingress", domain: "api.samsung.lepton.network", pathPrefix: "/api", targetService: "n3-neo360-api-svc", targetPort: 8080 },
    { key: "rte-sam-web", site: "samsung-prod", dt: "samsung-prod-prod", kind: "ingress", domain: "samsung.lepton.network", targetService: "n3-neo360-ui-site", targetPort: 3000 },
    // NYC DOT
    { key: "rte-nyc-api", site: "nyc-dot-prod", dt: "nyc-dot-prod-prod", kind: "ingress", domain: "api.nycdot.lepton.network", pathPrefix: "/api", targetService: "tf-traffic-api-svc", targetPort: 8080 },
    { key: "rte-nyc-web", site: "nyc-dot-prod", dt: "nyc-dot-prod-prod", kind: "ingress", domain: "nycdot.lepton.network", targetService: "tf-traffic-ui-site", targetPort: 3000 },
    // BMW
    { key: "rte-bmw-api", site: "bmw-prod", dt: "bmw-prod-prod", kind: "ingress", domain: "api.bmw.lepton.network", pathPrefix: "/api", targetService: "so-ops-api-svc", targetPort: 8080 },
    { key: "rte-bmw-web", site: "bmw-prod", dt: "bmw-prod-prod", kind: "ingress", domain: "bmw.lepton.network", targetService: "so-ops-ui-site", targetPort: 3000 },
    // Walmart
    { key: "rte-wm-api", site: "walmart-prod", dt: "walmart-prod-prod", kind: "ingress", domain: "api.walmart.lepton.network", pathPrefix: "/api", targetService: "si-inventory-api-svc", targetPort: 8080 },
    { key: "rte-wm-web", site: "walmart-prod", dt: "walmart-prod-prod", kind: "ingress", domain: "walmart.lepton.network", targetService: "si-inventory-ui-site", targetPort: 3000 },
    // TfL
    { key: "rte-tfl-api", site: "tfl-prod", dt: "tfl-prod-prod", kind: "ingress", domain: "api.tfl.lepton.network", pathPrefix: "/api", targetService: "tf-traffic-api-svc", targetPort: 8080 },
    { key: "rte-tfl-web", site: "tfl-prod", dt: "tfl-prod-prod", kind: "ingress", domain: "tfl.lepton.network", targetService: "tf-traffic-ui-site", targetPort: 3000 },
    // Previews
    { key: "rte-prev-na", dt: "preview-na-feat-radius", kind: "preview", domain: "pr-42.preview.lepton.network", targetService: "na-core-api-svc", targetPort: 8080 },
    { key: "rte-prev-so", dt: "preview-so-alert-v2", kind: "preview", domain: "pr-87.preview.lepton.network", targetService: "so-ops-api-svc", targetPort: 8080 },
  ];

  await db.insert(s.route).values(
    routeData.map((r) => ({
      routeId: id("rte", r.key, "rte"),
      siteId: r.site ? id("site", r.site, "site") : null,
      deploymentTargetId: id("dt", r.dt, "dt"),
      kind: r.kind,
      domain: r.domain,
      pathPrefix: r.pathPrefix ?? null,
      targetService: r.targetService,
      targetPort: r.targetPort,
      status: "active",
      createdBy: id("prin", "deploy-bot", "prin"),
    }))
  );

  // --- Domains ---
  const domainData = [
    { key: "dom-vz", site: "verizon-prod", fqdn: "verizon.lepton.network", kind: "primary", status: "active", verified: true },
    { key: "dom-vz-api", site: "verizon-prod", fqdn: "api.verizon.lepton.network", kind: "alias", status: "active", verified: true },
    { key: "dom-sam", site: "samsung-prod", fqdn: "samsung.lepton.network", kind: "primary", status: "active", verified: true },
    { key: "dom-sam-api", site: "samsung-prod", fqdn: "api.samsung.lepton.network", kind: "alias", status: "active", verified: true },
    { key: "dom-nyc", site: "nyc-dot-prod", fqdn: "nycdot.lepton.network", kind: "primary", status: "active", verified: true },
    { key: "dom-bmw", site: "bmw-prod", fqdn: "bmw.lepton.network", kind: "primary", status: "active", verified: true },
    { key: "dom-wm", site: "walmart-prod", fqdn: "walmart.lepton.network", kind: "primary", status: "active", verified: true },
    { key: "dom-tfl", site: "tfl-prod", fqdn: "tfl.lepton.network", kind: "primary", status: "active", verified: true },
    // Custom domain for Verizon
    { key: "dom-vz-custom", site: "verizon-prod", fqdn: "network.verizon.com", kind: "custom", status: "verified", verified: true },
    // Preview wildcard
    { key: "dom-preview", fqdn: "*.preview.lepton.network", kind: "wildcard", status: "active", verified: true },
  ];

  await db.insert(s.domain).values(
    domainData.map((d) => ({
      domainId: id("dom", d.key, "dom"),
      siteId: d.site ? id("site", d.site, "site") : null,
      fqdn: d.fqdn,
      kind: d.kind,
      dnsVerified: d.verified,
      status: d.status,
      createdBy: id("prin", "deploy-bot", "prin"),
    }))
  );

  // --- Tunnels ---
  await db.insert(s.tunnel).values([
    {
      routeId: id("rte", "rte-prev-na", "rte"),
      principalId: id("prin", "maria-garcia", "prin"),
      subdomain: "maria-na-dev",
      localAddr: "localhost:8080",
      status: "active",
    },
    {
      routeId: id("rte", "rte-prev-so", "rte"),
      principalId: id("prin", "lisa-wang", "prin"),
      subdomain: "lisa-so-dev",
      localAddr: "localhost:8080",
      status: "active",
    },
  ]);
}

// ── Phase 9: Agents ──────────────────────────────────────────────

async function seedAgents() {
  // --- Agent Principals (insert before agents since agents FK to principals) ---
  const agentPrincipals = [
    { key: "agent-claude-eng", name: "Claude Engineering Agent", team: "devex" },
    { key: "agent-qa-bot", name: "QA Bot Agent", team: "qa" },
    { key: "agent-deploy", name: "Deploy Agent", team: "infra" },
    { key: "agent-security", name: "Security Scanner Agent", team: "security" },
    { key: "agent-mcp-bridge", name: "MCP Bridge Agent", team: "platform" },
  ];

  await db.insert(s.orgPrincipal).values(
    agentPrincipals.map((ap) => ({
      principalId: id("prin", ap.key, "prin"),
      name: ap.name,
      slug: ap.key,
      type: "agent" as const,
      teamId: id("team", ap.team, "team"),
    }))
  );

  // --- Agents ---
  const agents = [
    { key: "claude-eng", name: "Claude Engineer", slug: "claude-engineer", type: "engineering", principal: "agent-claude-eng", caps: { languages: ["typescript", "go", "python"], tools: ["git", "docker", "kubectl"] } },
    { key: "qa-bot", name: "QA Bot", slug: "qa-bot", type: "qa", principal: "agent-qa-bot", caps: { frameworks: ["vitest", "playwright"], tools: ["git"] } },
    { key: "deploy-agent", name: "Deploy Agent", slug: "deploy-agent", type: "ops", principal: "agent-deploy", caps: { tools: ["kubectl", "helm", "docker"], platforms: ["kubernetes"] } },
    { key: "sec-scanner", name: "Security Scanner", slug: "security-scanner", type: "security", principal: "agent-security", caps: { scanners: ["trivy", "semgrep", "snyk"] } },
    { key: "mcp-bridge", name: "MCP Bridge", slug: "mcp-bridge", type: "external-mcp", principal: "agent-mcp-bridge", caps: { protocols: ["mcp"], tools: ["claude-code"] } },
  ];

  await db.insert(s.agent).values(
    agents.map((a) => ({
      agentId: id("agt", a.key, "agt"),
      name: a.name,
      slug: a.slug,
      agentType: a.type,
      principalId: id("prin", a.principal, "prin"),
      capabilities: a.caps,
    }))
  );

  // --- Agent Executions ---
  const executions = [
    { agent: "claude-eng", task: "Implement RADIUS auth flow for Network Access", status: "succeeded", costCents: 45 },
    { agent: "claude-eng", task: "Refactor SmartOps alert manager", status: "succeeded", costCents: 32 },
    { agent: "claude-eng", task: "Add Knox integration to Neo360", status: "running", costCents: 0 },
    { agent: "qa-bot", task: "Run E2E tests for Network Access v1.2.0-rc1", status: "succeeded", costCents: 12 },
    { agent: "qa-bot", task: "Run E2E tests for SmartOps v1.2.0-rc1", status: "failed", costCents: 8 },
    { agent: "deploy-agent", task: "Roll out v2024.1.0 to Verizon US East", status: "succeeded", costCents: 5 },
    { agent: "deploy-agent", task: "Roll out v2024.1.0 to Samsung APAC", status: "succeeded", costCents: 5 },
    { agent: "sec-scanner", task: "Scan Network Access images for CVEs", status: "succeeded", costCents: 3 },
    { agent: "sec-scanner", task: "Scan Neo360 images for CVEs", status: "running", costCents: 0 },
    { agent: "mcp-bridge", task: "Sync Jira tickets for SmartOps", status: "succeeded", costCents: 2 },
  ];

  await db.insert(s.agentExecution).values(
    executions.map((e) => ({
      agentId: id("agt", e.agent, "agt"),
      task: e.task,
      status: e.status,
      costCents: e.costCents,
      completedAt: e.status !== "running" ? new Date() : null,
    }))
  );
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding Lepton factory database...\n");

  // Truncate all tables (reverse dependency order)
  console.log("  Truncating existing data...");
  await db.execute(sql`
    TRUNCATE
      factory_agent.agent_execution,
      factory_agent.agent,
      factory_fleet.tunnel,
      factory_fleet.domain,
      factory_fleet.route,
      factory_fleet.sandbox_snapshot,
      factory_fleet.sandbox,
      factory_fleet.preview,
      factory_fleet.connection_audit_event,
      factory_fleet.release_bundle,
      factory_fleet.install_manifest,
      factory_fleet.site_manifest,
      factory_fleet.workload_override,
      factory_fleet.intervention,
      factory_fleet.dependency_workload,
      factory_fleet.workload,
      factory_fleet.rollout,
      factory_fleet.deployment_target,
      factory_fleet.release_module_pin,
      factory_fleet.release,
      factory_fleet.sandbox_template,
      factory_fleet.site,
      factory_commerce.entitlement_bundle,
      factory_commerce.entitlement,
      factory_commerce.plan,
      factory_commerce.customer_account,
      factory_build.git_user_sync,
      factory_build.git_repo_sync,
      factory_build.webhook_event,
      factory_build.github_app_installation,
      factory_build.component_artifact,
      factory_build.artifact,
      factory_build.module_version,
      factory_build.repo,
      factory_build.git_host_provider,
      factory_catalog.entity_link,
      factory_catalog.api,
      factory_catalog.resource,
      factory_catalog.component,
      factory_catalog.system,
      factory_catalog.domain,
      factory_product.work_item,
      factory_product.work_tracker_project_mapping,
      factory_product.work_tracker_provider,
      factory_product.component_spec,
      factory_product.module,
      factory_infra.ip_address,
      factory_infra.subnet,
      factory_infra.kube_node,
      factory_infra.vm,
      factory_infra.vm_cluster,
      factory_infra.cluster,
      factory_infra.host,
      factory_infra.datacenter,
      factory_infra.region,
      factory_infra.provider,
      factory_org.tool_usage,
      factory_org.tool_credential,
      factory_org.identity_link,
      factory_org.scope,
      factory_org.principal_team_membership,
      factory_org.principal,
      factory_org.team
    CASCADE
  `);

  await seedOrg();
  console.log("  [1/9] Org seeded (teams, principals, memberships, scopes, identity links)");

  await seedInfra();
  console.log("  [2/9] Infra seeded (providers, regions, DCs, hosts, clusters, VMs, subnets)");

  await seedProduct();
  console.log("  [3/9] Product seeded (modules, components, work items)");

  await seedCatalog();
  console.log("  [4/9] Catalog seeded (domains, systems, components, resources, APIs)");

  await seedBuild();
  console.log("  [5/9] Build seeded (git providers, repos, versions, artifacts)");

  await seedCommerce();
  console.log("  [6/9] Commerce seeded (customers, plans, entitlements, bundles)");

  await seedFleet();
  console.log("  [7/9] Fleet seeded (sites, releases, targets, workloads, previews, sandboxes)");

  await seedGateway();
  console.log("  [8/9] Gateway seeded (routes, domains, tunnels)");

  await seedAgents();
  console.log("  [9/9] Agents seeded (agents, executions)");

  console.log("\nSeed complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
