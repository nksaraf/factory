/**
 * Lepton full infrastructure seed — layers on top of seed-prod.ts.
 *
 * Seeds everything that can't be discovered by scan or Proxmox sync:
 * - ISP links, public IPs, NAT mappings
 * - Gajshield firewall (network appliance)
 * - Legacy Windows servers (bare-metal on 1.x subnet)
 * - Storage devices
 * - DNS zones and domains
 * - External services (GCP, Hetzner, Sci-Future placeholders)
 * - Network links (ISP → firewall → subnets)
 *
 * Run: FACTORY_DATABASE_URL=postgres://... bun run api/src/db/seed-lepton.ts
 *
 * Safe to re-run — uses ON CONFLICT DO NOTHING on unique slugs/addresses.
 */
import { sql } from "drizzle-orm"

import { type EntityPrefix, newId } from "../lib/id"
import { connection } from "./connection"
import {
  dnsDomain,
  estate,
  host,
  ipAddress,
  networkLink,
  service,
} from "./schema/infra-v2"

const db = connection(
  process.env.FACTORY_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/postgres"
)

// ── ID helpers ──────────────────────────────────────────────────
const ids: Record<string, Record<string, string>> = {}

function id(ns: string, key: string, prefix: EntityPrefix): string {
  if (!ids[ns]) ids[ns] = {}
  if (!ids[ns][key]) ids[ns][key] = newId(prefix)
  return ids[ns][key]
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100)
}

// ── Resolve existing estate IDs by slug ─────────────────────────
async function resolveEstateId(slug: string): Promise<string | null> {
  const rows = await db
    .select({ id: estate.id })
    .from(estate)
    .where(sql`${estate.slug} = ${slug}`)
    .limit(1)
  return rows[0]?.id ?? null
}

async function resolveHostId(slug: string): Promise<string | null> {
  const rows = await db
    .select({ id: host.id })
    .from(host)
    .where(sql`${host.slug} = ${slug}`)
    .limit(1)
  return rows[0]?.id ?? null
}

// ── Data ────────────────────────────────────────────────────────

// Airtel public IPs and their NAT mappings
const AIRTEL_WAN_IP = "182.74.24.70"
const AIRTEL_GATEWAY = "182.74.24.69"
const AIRTEL_NAT_MAPPINGS = [
  { publicIp: "182.71.49.114", privateIp: "192.168.1.64", note: "ADTRAN POC" },
  {
    publicIp: "182.71.49.115",
    privateIp: "192.168.1.26",
    note: "FTP Server",
  },
  { publicIp: "182.71.49.116", privateIp: null, note: "Free" },
  {
    publicIp: "182.71.49.117",
    privateIp: "192.168.1.59",
    note: "Nikhil/Umang Server (lepton-59)",
  },
  {
    publicIp: "182.71.49.118",
    privateIp: "192.168.1.124",
    note: "Neo360 Demo",
  },
]

// Tata public IPs and their NAT mappings
const TATA_WAN_IP = "14.98.61.194"
const TATA_NAT_MAPPINGS = [
  {
    publicIp: "14.98.61.195",
    privateIp: "192.168.1.14",
    note: "Neo360 Dev/Demo",
  },
  {
    publicIp: "14.98.61.196",
    privateIp: "192.168.1.31",
    note: "Relyon Biometric Server",
  },
  {
    publicIp: "14.98.61.197",
    privateIp: "192.168.1.41",
    note: "JIO App SIT/Presales",
  },
]

// Windows bare-metal servers on 1.x subnet (not in Proxmox)
const WINDOWS_SERVERS: {
  ip: string
  hostname: string
  model: string
  os: string
  cpu: string
  ram: string
  disk: string
  note: string
}[] = [
  {
    ip: "192.168.1.3",
    hostname: "WINDOWS-NTHCHFQ",
    model: "HP ProLiant DL180 Gen9",
    os: "Windows Server 2012 R2",
    cpu: "Xeon E5-2630 v3 16C",
    ram: "32 GB",
    disk: "3 TB",
    note: "Legacy server",
  },
  {
    ip: "192.168.1.11",
    hostname: "LEPDOMINDIA",
    model: "HP ProLiant DL380 G6",
    os: "Windows Server 2012 R2",
    cpu: "Xeon E5504 8C",
    ram: "8 GB",
    disk: "300 GB",
    note: "IT Domain controller",
  },
  {
    ip: "192.168.1.14",
    hostname: "WIN-4UJ6ERFK323",
    model: "HPE DL360 Gen10",
    os: "Windows Server 2019",
    cpu: "Xeon Gold 5218R 40C x2",
    ram: "64 GB",
    disk: "4 TB",
    note: "Neo360 server (Umang)",
  },
  {
    ip: "192.168.1.25",
    hostname: "WIN-J4LEO1C57SN",
    model: "HPE DL360 Gen10",
    os: "Windows Server 2019",
    cpu: "Xeon Gold 5218R 40C x2",
    ram: "64 GB",
    disk: "4 TB",
    note: "Telecom server (Mandeep)",
  },
  {
    ip: "192.168.1.26",
    hostname: "FTP-Server",
    model: "HP ProLiant DL380 G6",
    os: "Windows Server 2016",
    cpu: "Xeon X5650 8C",
    ram: "8 GB",
    disk: "150 GB",
    note: "FTP Server",
  },
  {
    ip: "192.168.1.40",
    hostname: "WIN-M6NPLP2FVJ7",
    model: "HPE DL380 Gen10",
    os: "Windows Server 2022",
    cpu: "Xeon Gold 6248R 48C x2",
    ram: "128 GB",
    disk: "2880 GB SSD",
    note: "Server-40",
  },
  {
    ip: "192.168.1.41",
    hostname: "WIN-8OU5HBQ7GNF",
    model: "HPE DL380 Gen10",
    os: "Windows Server 2022",
    cpu: "Xeon Gold 6248R 48C x2",
    ram: "128 GB",
    disk: "2880 GB SSD",
    note: "Server-41",
  },
  {
    ip: "192.168.1.197",
    hostname: "LEP-GGN-DC",
    model: "HP ProLiant DL360 G7",
    os: "Windows Server 2012 R2",
    cpu: "Xeon X5650 12C",
    ram: "16 GB",
    disk: "500 GB",
    note: "Legacy DC server",
  },
]

// Storage devices
const STORAGE_DEVICES = [
  { ip: "192.168.1.12", name: "Dell EMC Storage 1", type: "storage" },
  { ip: "192.168.1.13", name: "Dell EMC Storage 2", type: "storage" },
  { ip: "192.168.1.16", name: "Dell EMC Storage 3", type: "storage" },
  { ip: "192.168.1.30", name: "Netgear Storage", type: "storage" },
]

// Domains
const DOMAINS: {
  fqdn: string
  registrar: string
  nameservers: string
  type: "primary" | "alias"
}[] = [
  {
    fqdn: "rio.software",
    registrar: "namecheap",
    nameservers: "cloudflare",
    type: "primary",
  },
  {
    fqdn: "lepton.software",
    registrar: "namecheap",
    nameservers: "cloudflare",
    type: "primary",
  },
  {
    fqdn: "leptonmaps.com",
    registrar: "verio",
    nameservers: "verio",
    type: "primary",
  },
  {
    fqdn: "trafficure.com",
    registrar: "cloudflare",
    nameservers: "cloudflare",
    type: "primary",
  },
  {
    fqdn: "smartmarket.ai",
    registrar: "cloudflare",
    nameservers: "cloudflare",
    type: "primary",
  },
  {
    fqdn: "leptonsoftware.com",
    registrar: "godaddy",
    nameservers: "godaddy",
    type: "primary",
  },
  {
    fqdn: "leptonsoftware.ai",
    registrar: "godaddy",
    nameservers: "godaddy",
    type: "primary",
  },
  {
    fqdn: "leptonsoftware.co",
    registrar: "godaddy",
    nameservers: "godaddy",
    type: "primary",
  },
  {
    fqdn: "pathlosssoftware.com",
    registrar: "godaddy",
    nameservers: "godaddy",
    type: "primary",
  },
  {
    fqdn: "networkaccess.co",
    registrar: "godaddy",
    nameservers: "godaddy",
    type: "primary",
  },
]

// ── Seed functions ──────────────────────────────────────────────

async function seedISPEstates() {
  // Resolve existing datacenter estate
  const dcId = await resolveEstateId("lepton-datacenter")
  if (!dcId)
    throw new Error("lepton-datacenter estate not found — run seed-prod first")

  const airtelId = id("est", "airtel-wan", "est")
  const tataId = id("est", "tata-ill", "est")

  await db
    .insert(estate)
    .values([
      {
        id: airtelId,
        slug: "airtel-wan",
        name: "Airtel WAN Link",
        type: "wan",
        parentEstateId: dcId,
        spec: {
          providerKind: "airtel",
          lifecycle: "active",
          metadata: {
            wanIp: AIRTEL_WAN_IP,
            gateway: AIRTEL_GATEWAY,
            subnetMask: "255.255.255.252",
            bandwidth: "unspecified",
          },
        },
      },
      {
        id: tataId,
        slug: "tata-ill",
        name: "Tata 50 Mbps ILL",
        type: "wan",
        parentEstateId: dcId,
        spec: {
          providerKind: "tata",
          lifecycle: "active",
          metadata: {
            wanIp: TATA_WAN_IP,
            bandwidth: "50 Mbps",
          },
        },
      },
    ])
    .onConflictDoNothing()

  // Public IP addresses
  const allPublicIps = [
    // Airtel WAN
    { address: AIRTEL_WAN_IP, estate: airtelId, note: "Airtel WAN IP" },
    {
      address: AIRTEL_GATEWAY,
      estate: airtelId,
      note: "Airtel Gateway",
    },
    ...AIRTEL_NAT_MAPPINGS.map((m) => ({
      address: m.publicIp,
      estate: airtelId,
      note: m.note,
    })),
    // Tata
    { address: TATA_WAN_IP, estate: tataId, note: "Tata WAN/Firewall" },
    ...TATA_NAT_MAPPINGS.map((m) => ({
      address: m.publicIp,
      estate: tataId,
      note: m.note,
    })),
  ]

  await db
    .insert(ipAddress)
    .values(
      allPublicIps.map((ip) => ({
        address: ip.address,
        subnetId: ip.estate,
        spec: {
          version: "v4" as const,
          status: "assigned" as const,
          scope: "public",
          purpose: ip.note,
        },
      }))
    )
    .onConflictDoNothing()

  return { airtelId, tataId }
}

async function seedFirewall() {
  const dcId = await resolveEstateId("lepton-datacenter")
  if (!dcId) throw new Error("lepton-datacenter estate not found")

  const fwId = id("host", "gajshield-fw", "host")

  await db
    .insert(host)
    .values({
      id: fwId,
      slug: "gajshield-fw",
      name: "Gajshield Firewall",
      type: "network-appliance",
      estateId: dcId,
      spec: {
        hostname: "gajshield",
        os: "linux" as const,
        arch: "amd64" as const,
        ipAddress: "192.168.1.5",
        lifecycle: "active" as const,
        accessMethod: "ssh" as const,
        model: "Gajshield",
        managementUrl: "https://192.168.1.5",
      },
    })
    .onConflictDoNothing()

  // Assign the firewall's IP
  await db
    .insert(ipAddress)
    .values({
      address: "192.168.1.5",
      subnetId: (await resolveEstateId("mgmt-subnet"))!,
      spec: {
        version: "v4" as const,
        status: "assigned" as const,
        assignedToType: "host",
        assignedToId: fwId,
        purpose: "Gajshield Firewall",
      },
    })
    .onConflictDoNothing()

  return fwId
}

async function seedWindowsServers() {
  const dcId = await resolveEstateId("lepton-datacenter")
  const mgmtSubnetId = await resolveEstateId("mgmt-subnet")
  if (!dcId || !mgmtSubnetId)
    throw new Error("Estate not found — run seed-prod first")

  const hostValues = WINDOWS_SERVERS.map((srv) => {
    const slug = slugify(srv.hostname)
    const cpuCores = parseInt(srv.cpu.match(/(\d+)C/)?.[1] ?? "0")
    const ramMb = parseInt(srv.ram) * 1024

    return {
      id: id("host", slug, "host"),
      slug,
      name: srv.note || srv.hostname,
      type: "bare-metal" as const,
      estateId: dcId,
      spec: {
        hostname: srv.hostname,
        os: "windows" as const,
        arch: "amd64" as const,
        cpu: cpuCores,
        memoryMb: ramMb,
        ipAddress: srv.ip,
        lifecycle: "active" as const,
        accessMethod: "rdp" as const,
        accessUser: "Administrator",
        model: srv.model,
      },
    }
  })

  await db.insert(host).values(hostValues).onConflictDoNothing()

  // IP addresses for Windows servers
  await db
    .insert(ipAddress)
    .values(
      WINDOWS_SERVERS.map((srv) => ({
        address: srv.ip,
        subnetId: mgmtSubnetId,
        spec: {
          version: "v4" as const,
          status: "assigned" as const,
          assignedToType: "host",
          assignedToId: id("host", slugify(srv.hostname), "host"),
          purpose: `${srv.model} — ${srv.os}`,
        },
      }))
    )
    .onConflictDoNothing()
}

async function seedStorageDevices() {
  const dcId = await resolveEstateId("lepton-datacenter")
  const mgmtSubnetId = await resolveEstateId("mgmt-subnet")
  if (!dcId || !mgmtSubnetId) throw new Error("Estate not found")

  const hostValues = STORAGE_DEVICES.map((dev) => {
    const slug = slugify(dev.name)
    return {
      id: id("host", slug, "host"),
      slug,
      name: dev.name,
      type: "bare-metal" as const,
      estateId: dcId,
      spec: {
        hostname: dev.name,
        ipAddress: dev.ip,
        lifecycle: "active" as const,
        role: "storage",
      },
    }
  })

  await db.insert(host).values(hostValues).onConflictDoNothing()

  await db
    .insert(ipAddress)
    .values(
      STORAGE_DEVICES.map((dev) => ({
        address: dev.ip,
        subnetId: mgmtSubnetId,
        spec: {
          version: "v4" as const,
          status: "assigned" as const,
          assignedToType: "host",
          assignedToId: id("host", slugify(dev.name), "host"),
          purpose: dev.name,
        },
      }))
    )
    .onConflictDoNothing()
}

async function seedDNSEstatesAndDomains() {
  const dcId = await resolveEstateId("lepton-datacenter")
  if (!dcId) throw new Error("lepton-datacenter estate not found")

  // Group domains by DNS provider
  const providers = new Map<string, typeof DOMAINS>()
  for (const d of DOMAINS) {
    if (!providers.has(d.nameservers)) providers.set(d.nameservers, [])
    providers.get(d.nameservers)!.push(d)
  }

  // Create DNS zone estates per provider
  for (const [provider, domains] of providers) {
    const estateSlug = `dns-${provider}`
    const estId = id("est", estateSlug, "est")

    await db
      .insert(estate)
      .values({
        id: estId,
        slug: estateSlug,
        name: `DNS (${provider})`,
        type: "dns-zone",
        parentEstateId: dcId,
        spec: {
          providerKind: provider,
          dnsProvider: provider,
          lifecycle: "active",
          metadata: {
            domains: domains.map((d) => d.fqdn),
          },
        },
      })
      .onConflictDoNothing()

    // Create DNS domain entities
    for (const d of domains) {
      const domSlug = slugify(d.fqdn)
      await db
        .insert(dnsDomain)
        .values({
          id: id("dom", domSlug, "dom"),
          slug: domSlug,
          name: d.fqdn,
          type: d.type,
          fqdn: d.fqdn,
          spec: {
            registrar: d.registrar,
            dnsProvider: d.nameservers,
          },
        })
        .onConflictDoNothing()
    }
  }
}

async function seedNATLinks(
  firewallId: string,
  airtelEstateId: string,
  tataEstateId: string
) {
  const allNat = [
    ...AIRTEL_NAT_MAPPINGS.filter((m) => m.privateIp).map((m) => ({
      ...m,
      isp: "airtel",
    })),
    ...TATA_NAT_MAPPINGS.filter((m) => m.privateIp).map((m) => ({
      ...m,
      isp: "tata",
    })),
  ]

  for (const nat of allNat) {
    // Try to resolve the target host by IP
    const [targetHost] = await db
      .select({ id: host.id, slug: host.slug })
      .from(host)
      .where(sql`${host.spec}->>'ipAddress' = ${nat.privateIp}`)
      .limit(1)

    const linkSlug = slugify(`nat-${nat.publicIp}-to-${nat.privateIp}`)

    await db
      .insert(networkLink)
      .values({
        id: newId("nlnk"),
        slug: linkSlug,
        name: `NAT ${nat.publicIp} → ${nat.privateIp} (${nat.note})`,
        type: "nat",
        sourceKind: "host",
        sourceId: firewallId,
        targetKind: targetHost ? "host" : "ip-address",
        targetId: targetHost?.id ?? nat.privateIp!,
        spec: {
          ingressPort: 0,
          egressPort: 0,
          egressProtocol: "tcp",
          description: `${nat.isp.toUpperCase()}: ${nat.publicIp} → ${nat.privateIp} (${nat.note})`,
          enabled: true,
        },
      })
      .onConflictDoNothing()
  }
}

async function seedExternalServices() {
  // GCP services
  const gcpId = await resolveEstateId("google-gcp")

  const services: {
    slug: string
    name: string
    type: string
    estateId: string | null
    spec: Record<string, unknown>
  }[] = [
    {
      slug: "gcp-bigquery",
      name: "Google BigQuery",
      type: "analytics",
      estateId: gcpId,
      spec: {
        provider: "gcp",
        protocol: "https",
        endpoint: "https://bigquery.googleapis.com",
      },
    },
    {
      slug: "gcp-gemini",
      name: "Google Gemini API",
      type: "llm",
      estateId: gcpId,
      spec: {
        provider: "gcp",
        protocol: "https",
        endpoint: "https://generativelanguage.googleapis.com",
      },
    },
    {
      slug: "github-lepton-org",
      name: "GitHub (LeptonSoftware)",
      type: "source-control",
      estateId: null,
      spec: {
        provider: "github",
        protocol: "https",
        endpoint: "https://github.com/LeptonSoftware",
      },
    },
    {
      slug: "jira-lepton",
      name: "Jira (Lepton)",
      type: "issue-tracker",
      estateId: null,
      spec: {
        provider: "atlassian",
        protocol: "https",
        endpoint: "https://leptonsoftware.atlassian.net",
      },
    },
    {
      slug: "slack-lepton",
      name: "Slack (Lepton)",
      type: "messaging",
      estateId: null,
      spec: {
        provider: "slack",
        protocol: "https",
        endpoint: "https://leptonsoftware.slack.com",
      },
    },
    {
      slug: "anthropic-claude",
      name: "Anthropic Claude API",
      type: "llm",
      estateId: null,
      spec: {
        provider: "anthropic",
        protocol: "https",
        endpoint: "https://api.anthropic.com",
      },
    },
  ]

  for (const svc of services) {
    await db
      .insert(service)
      .values({
        id: id("svc", svc.slug, "svc"),
        slug: svc.slug,
        name: svc.name,
        type: svc.type,
        estateId: svc.estateId,
        spec: svc.spec,
      })
      .onConflictDoNothing()
  }
}

async function seedHetznerAndSciFuture() {
  // Hetzner estate
  const hetznerId = id("est", "hetzner", "est")
  await db
    .insert(estate)
    .values({
      id: hetznerId,
      slug: "hetzner",
      name: "Hetzner Cloud",
      type: "cloud-account",
      spec: {
        providerKind: "hetzner",
        lifecycle: "active",
      },
    })
    .onConflictDoNothing()

  // Sci-Future estate
  const sciFutureId = id("est", "sci-future-dc", "est")
  await db
    .insert(estate)
    .values({
      id: sciFutureId,
      slug: "sci-future-dc",
      name: "Sci-Future Data Center",
      type: "datacenter",
      spec: {
        providerKind: "sci-future",
        lifecycle: "active",
        location: "India",
        metadata: {
          description: "External data center vendor — storage and compute",
        },
      },
    })
    .onConflictDoNothing()
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("Lepton infrastructure seed\n")

  // 1. ISP estates + public IPs
  const { airtelId, tataId } = await seedISPEstates()
  console.log("  [1/7] ISP estates + public IPs")

  // 2. Firewall
  const fwId = await seedFirewall()
  console.log("  [2/7] Gajshield firewall")

  // 3. Windows servers
  await seedWindowsServers()
  console.log("  [3/7] Windows bare-metal servers")

  // 4. Storage devices
  await seedStorageDevices()
  console.log("  [4/7] Storage devices")

  // 5. DNS zones + domains
  await seedDNSEstatesAndDomains()
  console.log("  [5/7] DNS zones + domains")

  // 6. NAT links (public → private IP mappings)
  await seedNATLinks(fwId, airtelId, tataId)
  console.log("  [6/7] NAT network links")

  // 7. External services + cloud providers
  await seedExternalServices()
  await seedHetznerAndSciFuture()
  console.log("  [7/7] External services + cloud estates")

  console.log("\nLepton seed complete!")
  process.exit(0)
}

main().catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})
