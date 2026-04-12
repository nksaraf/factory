export type DnsProviderType = "cloudflare" | "namecheap" | "godaddy"

export interface DnsProviderAdapterConfig {
  apiToken: string
  apiKey?: string
  apiSecret?: string
  apiUser?: string
  clientIp?: string
}

// ── Zone / Record types ────────────────────────────────────

export interface DnsZone {
  externalId: string
  name: string
  status: string
}

export interface DnsRecordEntry {
  externalId: string
  type: string // A, AAAA, CNAME, MX, TXT, NS, CAA, SRV, etc.
  name: string // FQDN
  content: string
  ttl: number
  priority?: number
  proxied?: boolean // Cloudflare-specific but harmless elsewhere
}

export interface CreateDnsRecordInput {
  type: string
  name: string
  content: string
  ttl?: number
  priority?: number
  proxied?: boolean
}

export interface UpdateDnsRecordInput {
  type?: string
  name?: string
  content?: string
  ttl?: number
  priority?: number
  proxied?: boolean
}

// ── Adapter interface ──────────────────────────────────────

export interface DnsProviderAdapter {
  readonly type: DnsProviderType

  // Read operations
  listZones(): Promise<DnsZone[]>
  listRecords(zoneId: string): Promise<DnsRecordEntry[]>

  // Write operations
  createRecord(
    zoneId: string,
    record: CreateDnsRecordInput
  ): Promise<DnsRecordEntry>
  updateRecord(
    zoneId: string,
    recordId: string,
    record: UpdateDnsRecordInput
  ): Promise<DnsRecordEntry>
  deleteRecord(zoneId: string, recordId: string): Promise<void>
}
