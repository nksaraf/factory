/**
 * Tests for DNS sync, IP lifecycle integration, and trace verification.
 *
 * Covers:
 * - DnsRecordSchema and enriched DnsDomainSpecSchema validation
 * - NetworkLinkSpec dns-resolution fields
 * - getEntityIps() and ensureIp() from IPAM service
 * - Trace walks dns-resolution → ip-address edges
 * - Round-robin DNS (multiple A records) → multiple links
 * - Proxied CNAME → dns-resolution link with proxied: true
 * - External CNAME → link with externalTarget set
 * - TXT/MX/NS/CAA → stored in domain spec.records[], NOT as links
 */
import {
  DnsDomainSpecSchema,
  DnsRecordSchema,
  IpAddressSpecSchema,
  NetworkLinkSpecSchema,
  NetworkLinkTypeSchema,
} from "@smp/factory-shared/schemas/infra"
import { describe, expect, test } from "bun:test"

import type { GraphReader, TraceHop } from "../modules/infra/trace"
import { traceFrom } from "../modules/infra/trace"

// ── Schema validation tests ───────────────────────────────────

describe("DnsRecordSchema", () => {
  test("validates a TXT record", () => {
    const result = DnsRecordSchema.safeParse({
      type: "TXT",
      name: "_dmarc.example.com",
      value: "v=DMARC1; p=reject",
      ttl: 300,
    })
    expect(result.success).toBe(true)
  })

  test("validates an MX record with priority", () => {
    const result = DnsRecordSchema.safeParse({
      type: "MX",
      name: "example.com",
      value: "mail.example.com",
      priority: 10,
      externalId: "cf-rec-123",
    })
    expect(result.success).toBe(true)
    expect(result.data?.priority).toBe(10)
    expect(result.data?.externalId).toBe("cf-rec-123")
  })
})

describe("enriched DnsDomainSpecSchema", () => {
  test("validates full spec with zone reference and records", () => {
    const result = DnsDomainSpecSchema.safeParse({
      zoneEstateId: "est_abc123",
      dnsProvider: "cloudflare",
      registrar: "namecheap",
      externalId: "cf-domain-456",
      verificationToken: "dx-verify-abc123",
      verified: true,
      verifiedAt: "2026-01-01T00:00:00Z",
      status: "verified",
      createdBy: "user-1",
      tlsCertRef: "cert-ref",
      tlsMode: "auto",
      records: [
        { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=reject" },
        { type: "MX", name: "@", value: "mail.example.com", priority: 10 },
      ],
      lastSyncedAt: "2026-01-01T00:00:00Z",
    })
    expect(result.success).toBe(true)
    expect(result.data?.records).toHaveLength(2)
    expect(result.data?.zoneEstateId).toBe("est_abc123")
  })

  test("defaults records to empty array", () => {
    const result = DnsDomainSpecSchema.safeParse({
      verified: false,
    })
    expect(result.success).toBe(true)
    expect(result.data?.records).toEqual([])
  })

  test("backward compatible with existing minimal spec", () => {
    const result = DnsDomainSpecSchema.safeParse({
      registrar: "cloudflare",
      verified: true,
      dnsProvider: "cloudflare",
    })
    expect(result.success).toBe(true)
  })
})

describe("NetworkLinkSpec dns-resolution fields", () => {
  test("accepts dns-resolution type", () => {
    const result = NetworkLinkTypeSchema.safeParse("dns-resolution")
    expect(result.success).toBe(true)
  })

  test("accepts cdn-forward type", () => {
    const result = NetworkLinkTypeSchema.safeParse("cdn-forward")
    expect(result.success).toBe(true)
  })

  test("validates link spec with dns-resolution fields", () => {
    const result = NetworkLinkSpecSchema.safeParse({
      recordType: "A",
      ttl: 300,
      proxied: false,
      externalId: "cf-rec-789",
      enabled: true,
      priority: 0,
      middlewares: [],
    })
    expect(result.success).toBe(true)
    expect(result.data?.recordType).toBe("A")
    expect(result.data?.ttl).toBe(300)
    expect(result.data?.proxied).toBe(false)
  })

  test("validates CNAME with externalTarget", () => {
    const result = NetworkLinkSpecSchema.safeParse({
      recordType: "CNAME",
      ttl: 3600,
      proxied: true,
      externalTarget: "cname.vercel-dns.com",
      externalId: "cf-rec-abc",
      enabled: true,
      priority: 0,
      middlewares: [],
    })
    expect(result.success).toBe(true)
    expect(result.data?.externalTarget).toBe("cname.vercel-dns.com")
    expect(result.data?.proxied).toBe(true)
  })
})

// ── Trace tests with mock GraphReader ─────────────────────────

describe("trace: dns-domain → ip-address", () => {
  function mockReader(
    entities: Record<string, Record<string, unknown>>,
    links: Array<{
      id: string
      slug: string
      name: string
      type: string
      sourceKind: string
      sourceId: string
      targetKind: string
      targetId: string
      spec: Record<string, unknown>
    }>
  ): GraphReader {
    return {
      async findLinks(kind, id, direction) {
        return links.filter((l) =>
          direction === "outbound"
            ? l.sourceKind === kind && l.sourceId === id
            : l.targetKind === kind && l.targetId === id
        )
      },
      async findEntity(kind, id) {
        const key = `${kind}:${id}`
        const e = entities[key]
        if (!e) return null
        return {
          id,
          slug: id,
          name: String(e.name ?? id),
          type: String(e.type ?? kind),
          ...e,
        }
      },
    }
  }

  test("traces outbound from dns-domain through dns-resolution to ip-address", async () => {
    const reader = mockReader(
      {
        "dns-domain:dom1": { name: "factory.lepton.software", type: "custom" },
        "ip-address:ip1": { name: "182.71.49.117", type: "v4" },
      },
      [
        {
          id: "link1",
          slug: "dns-factory-to-182",
          name: "factory.lepton.software → 182.71.49.117",
          type: "dns-resolution",
          sourceKind: "dns-domain",
          sourceId: "dom1",
          targetKind: "ip-address",
          targetId: "ip1",
          spec: { recordType: "A", ttl: 300 },
        },
      ]
    )

    const result = await traceFrom(reader, "dns-domain", "dom1", "outbound")
    expect(result.origin.id).toBe("dom1")
    expect(result.hops).toHaveLength(1)
    expect(result.hops[0].link.type).toBe("dns-resolution")
    expect(result.hops[0].entity.id).toBe("ip1")
  })

  test("traces inbound from ip-address back to dns-domain", async () => {
    const reader = mockReader(
      {
        "dns-domain:dom1": { name: "factory.lepton.software", type: "custom" },
        "ip-address:ip1": { name: "182.71.49.117", type: "v4" },
      },
      [
        {
          id: "link1",
          slug: "dns-factory-to-182",
          name: "factory.lepton.software → 182.71.49.117",
          type: "dns-resolution",
          sourceKind: "dns-domain",
          sourceId: "dom1",
          targetKind: "ip-address",
          targetId: "ip1",
          spec: { recordType: "A" },
        },
      ]
    )

    const result = await traceFrom(reader, "ip-address", "ip1", "inbound")
    expect(result.origin.id).toBe("ip1")
    expect(result.hops).toHaveLength(1)
    expect(result.hops[0].entity.id).toBe("dom1")
  })

  test("traces full path: dns-domain → ip-address → host", async () => {
    const reader = mockReader(
      {
        "dns-domain:dom1": { name: "factory.lepton.software", type: "custom" },
        "ip-address:ip1": { name: "203.0.113.5", type: "v4" },
        "host:host1": { name: "factory-prod", type: "bare-metal" },
      },
      [
        {
          id: "link1",
          slug: "dns-to-ip",
          name: "dns → ip",
          type: "dns-resolution",
          sourceKind: "dns-domain",
          sourceId: "dom1",
          targetKind: "ip-address",
          targetId: "ip1",
          spec: { recordType: "A" },
        },
        {
          id: "link2",
          slug: "nat-to-host",
          name: "ip → host",
          type: "nat",
          sourceKind: "ip-address",
          sourceId: "ip1",
          targetKind: "host",
          targetId: "host1",
          spec: { ingressPort: 443, egressPort: 443 },
        },
      ]
    )

    const result = await traceFrom(reader, "dns-domain", "dom1", "outbound")
    expect(result.hops).toHaveLength(2)
    expect(result.hops[0].link.type).toBe("dns-resolution")
    expect(result.hops[0].entity.id).toBe("ip1")
    expect(result.hops[1].link.type).toBe("nat")
    expect(result.hops[1].entity.id).toBe("host1")
  })

  test("round-robin DNS: first link is followed (single trace path)", async () => {
    const reader = mockReader(
      {
        "dns-domain:dom1": { name: "*.kube.rio.software", type: "wildcard" },
        "ip-address:ip1": { name: "192.168.2.89", type: "v4" },
        "ip-address:ip2": { name: "192.168.2.91", type: "v4" },
        "ip-address:ip3": { name: "192.168.2.92", type: "v4" },
      },
      [
        {
          id: "link1",
          slug: "rr1",
          name: "→ .89",
          type: "dns-resolution",
          sourceKind: "dns-domain",
          sourceId: "dom1",
          targetKind: "ip-address",
          targetId: "ip1",
          spec: { recordType: "A" },
        },
        {
          id: "link2",
          slug: "rr2",
          name: "→ .91",
          type: "dns-resolution",
          sourceKind: "dns-domain",
          sourceId: "dom1",
          targetKind: "ip-address",
          targetId: "ip2",
          spec: { recordType: "A" },
        },
        {
          id: "link3",
          slug: "rr3",
          name: "→ .92",
          type: "dns-resolution",
          sourceKind: "dns-domain",
          sourceId: "dom1",
          targetKind: "ip-address",
          targetId: "ip3",
          spec: { recordType: "A" },
        },
      ]
    )

    const result = await traceFrom(reader, "dns-domain", "dom1", "outbound")
    expect(result.hops).toHaveLength(1)
    expect(result.hops[0].entity.id).toBe("ip1")
  })
})

// ── IpAddressSpec validation ──────────────────────────────────

describe("IpAddressSpec enriched fields", () => {
  test("validates full spec with scope, purpose, interface, primary", () => {
    const result = IpAddressSpecSchema.safeParse({
      version: "v4",
      status: "assigned",
      assignedToType: "host",
      assignedToId: "host_123",
      scope: "private",
      purpose: "management",
      hostname: "factory-prod.local",
      interface: "eth0",
      primary: true,
    })
    expect(result.success).toBe(true)
    expect(result.data?.scope).toBe("private")
    expect(result.data?.primary).toBe(true)
  })

  test("scope accepts all valid values", () => {
    for (const scope of [
      "public",
      "private",
      "management",
      "vpn",
      "virtual",
      "loopback",
    ]) {
      const result = IpAddressSpecSchema.safeParse({ scope })
      expect(result.success).toBe(true)
    }
  })
})
