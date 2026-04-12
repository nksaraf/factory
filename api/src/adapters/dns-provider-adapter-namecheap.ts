import type {
  CreateDnsRecordInput,
  DnsProviderAdapter,
  DnsProviderAdapterConfig,
  DnsRecordEntry,
  DnsZone,
  UpdateDnsRecordInput,
} from "./dns-provider-adapter"

const NC_API = "https://api.namecheap.com/xml.response"

/**
 * Namecheap DNS provider adapter.
 *
 * Namecheap's API uses XML and has a key constraint: setHosts replaces ALL
 * records for a domain at once. There are no individual record IDs — we
 * synthesize IDs from type+name+content for the adapter interface.
 */
export class NamecheapDnsProviderAdapter implements DnsProviderAdapter {
  readonly type = "namecheap" as const
  private readonly apiUser: string
  private readonly apiKey: string
  private readonly clientIp: string

  constructor(config: DnsProviderAdapterConfig) {
    this.apiUser = config.apiUser ?? ""
    this.apiKey = config.apiKey ?? config.apiToken
    this.clientIp = config.clientIp ?? "0.0.0.0"
  }

  private baseParams(): URLSearchParams {
    return new URLSearchParams({
      ApiUser: this.apiUser,
      ApiKey: this.apiKey,
      UserName: this.apiUser,
      ClientIp: this.clientIp,
    })
  }

  private async ncFetch(
    command: string,
    extra?: Record<string, string>
  ): Promise<string> {
    const params = this.baseParams()
    params.set("Command", command)
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        params.set(k, v)
      }
    }

    const res = await fetch(`${NC_API}?${params.toString()}`)
    if (!res.ok) {
      throw new Error(
        `Namecheap API ${command}: ${res.status} ${res.statusText}`
      )
    }
    const xml = await res.text()

    // Check for API-level errors
    if (xml.includes('Status="ERROR"')) {
      const errMatch = xml.match(/<Error[^>]*>(.*?)<\/Error>/s)
      throw new Error(
        `Namecheap API error: ${errMatch?.[1] ?? "unknown error"}`
      )
    }

    return xml
  }

  // Simple XML attribute extraction — avoids needing a full XML parser
  private extractAll(xml: string, tag: string): string[][] {
    const entries: string[][] = []
    const regex = new RegExp(`<${tag}\\s([^>]*?)\\/>`, "g")
    let match
    while ((match = regex.exec(xml)) !== null) {
      const attrs: string[] = []
      const attrRegex = /(\w+)="([^"]*)"/g
      let attrMatch
      while ((attrMatch = attrRegex.exec(match[1])) !== null) {
        attrs.push(attrMatch[1], attrMatch[2])
      }
      entries.push(attrs)
    }
    return entries
  }

  private extractAttr(attrs: string[], name: string): string {
    for (let i = 0; i < attrs.length; i += 2) {
      if (attrs[i] === name) return attrs[i + 1]
    }
    return ""
  }

  private syntheticId(type: string, name: string, content: string): string {
    return `${type}:${name}:${content}`
  }

  // Split a domain into SLD and TLD for Namecheap's API
  private splitDomain(domain: string): { sld: string; tld: string } {
    const parts = domain.split(".")
    if (parts.length > 2) {
      return { sld: parts[0], tld: parts.slice(1).join(".") }
    }
    return { sld: parts[0], tld: parts[1] }
  }

  // ── Read ───────────────────────────────────────────────────

  async listZones(): Promise<DnsZone[]> {
    const xml = await this.ncFetch("namecheap.domains.getList", {
      PageSize: "100",
    })

    const domains = this.extractAll(xml, "Domain")
    return domains.map((attrs) => ({
      externalId: this.extractAttr(attrs, "Name"),
      name: this.extractAttr(attrs, "Name"),
      status:
        this.extractAttr(attrs, "IsExpired") === "true" ? "expired" : "active",
    }))
  }

  async listRecords(zoneId: string): Promise<DnsRecordEntry[]> {
    const { sld, tld } = this.splitDomain(zoneId)
    const xml = await this.ncFetch("namecheap.domains.dns.getHosts", {
      SLD: sld,
      TLD: tld,
    })

    const hosts = this.extractAll(xml, "host")
    return hosts.map((attrs) => {
      const hostName = this.extractAttr(attrs, "Name")
      const type = this.extractAttr(attrs, "Type")
      const address = this.extractAttr(attrs, "Address")
      const fqdn = hostName === "@" ? zoneId : `${hostName}.${zoneId}`

      return {
        externalId: this.syntheticId(type, hostName, address),
        type,
        name: fqdn,
        content: address,
        ttl: parseInt(this.extractAttr(attrs, "TTL"), 10) || 1800,
        priority: parseInt(this.extractAttr(attrs, "MXPref"), 10) || undefined,
      }
    })
  }

  // ── Write ──────────────────────────────────────────────────
  //
  // Namecheap requires sending ALL host records at once via setHosts.
  // For create/update/delete, we read all records, modify, then write back.

  private async getAllHosts(zoneId: string): Promise<
    Array<{
      type: string
      name: string
      address: string
      ttl: string
      mxPref: string
    }>
  > {
    const { sld, tld } = this.splitDomain(zoneId)
    const xml = await this.ncFetch("namecheap.domains.dns.getHosts", {
      SLD: sld,
      TLD: tld,
    })

    const hosts = this.extractAll(xml, "host")
    return hosts.map((attrs) => ({
      type: this.extractAttr(attrs, "Type"),
      name: this.extractAttr(attrs, "Name"),
      address: this.extractAttr(attrs, "Address"),
      ttl: this.extractAttr(attrs, "TTL") || "1800",
      mxPref: this.extractAttr(attrs, "MXPref") || "10",
    }))
  }

  private async setAllHosts(
    zoneId: string,
    hosts: Array<{
      type: string
      name: string
      address: string
      ttl: string
      mxPref: string
    }>
  ): Promise<void> {
    const { sld, tld } = this.splitDomain(zoneId)
    const extra: Record<string, string> = { SLD: sld, TLD: tld }

    for (let i = 0; i < hosts.length; i++) {
      const h = hosts[i]
      const n = i + 1
      extra[`HostName${n}`] = h.name
      extra[`RecordType${n}`] = h.type
      extra[`Address${n}`] = h.address
      extra[`TTL${n}`] = h.ttl
      extra[`MXPref${n}`] = h.mxPref
    }

    await this.ncFetch("namecheap.domains.dns.setHosts", extra)
  }

  async createRecord(
    zoneId: string,
    record: CreateDnsRecordInput
  ): Promise<DnsRecordEntry> {
    const hosts = await this.getAllHosts(zoneId)
    const relativeName = this.toRelativeName(record.name, zoneId)

    hosts.push({
      type: record.type,
      name: relativeName,
      address: record.content,
      ttl: String(record.ttl ?? 1800),
      mxPref: String(record.priority ?? 10),
    })

    await this.setAllHosts(zoneId, hosts)

    const fqdn = relativeName === "@" ? zoneId : `${relativeName}.${zoneId}`
    return {
      externalId: this.syntheticId(record.type, relativeName, record.content),
      type: record.type,
      name: fqdn,
      content: record.content,
      ttl: record.ttl ?? 1800,
      priority: record.priority,
    }
  }

  async updateRecord(
    zoneId: string,
    recordId: string,
    record: UpdateDnsRecordInput
  ): Promise<DnsRecordEntry> {
    const [origType, origName, ...contentParts] = recordId.split(":")
    const origContent = contentParts.join(":")

    const hosts = await this.getAllHosts(zoneId)
    let updatedHost: (typeof hosts)[0] | undefined

    for (const h of hosts) {
      if (
        h.type === origType &&
        h.name === origName &&
        h.address === origContent
      ) {
        if (record.content !== undefined) h.address = record.content
        if (record.ttl !== undefined) h.ttl = String(record.ttl)
        if (record.priority !== undefined) h.mxPref = String(record.priority)
        if (record.type !== undefined) h.type = record.type
        if (record.name !== undefined)
          h.name = this.toRelativeName(record.name, zoneId)
        updatedHost = h
        break
      }
    }

    if (!updatedHost) {
      throw new Error(`Record ${recordId} not found in zone ${zoneId}`)
    }

    await this.setAllHosts(zoneId, hosts)

    const fqdn =
      updatedHost.name === "@" ? zoneId : `${updatedHost.name}.${zoneId}`
    return {
      externalId: this.syntheticId(
        updatedHost.type,
        updatedHost.name,
        updatedHost.address
      ),
      type: updatedHost.type,
      name: fqdn,
      content: updatedHost.address,
      ttl: parseInt(updatedHost.ttl, 10),
      priority: parseInt(updatedHost.mxPref, 10) || undefined,
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    const [type, name, ...contentParts] = recordId.split(":")
    const content = contentParts.join(":")

    const hosts = await this.getAllHosts(zoneId)
    const filtered = hosts.filter(
      (h) => !(h.type === type && h.name === name && h.address === content)
    )

    if (filtered.length === hosts.length) {
      throw new Error(`Record ${recordId} not found in zone ${zoneId}`)
    }

    await this.setAllHosts(zoneId, filtered)
  }

  // ── Helpers ────────────────────────────────────────────────

  private toRelativeName(fqdn: string, domain: string): string {
    if (fqdn === domain) return "@"
    if (fqdn.endsWith(`.${domain}`)) {
      return fqdn.slice(0, -(domain.length + 1))
    }
    return fqdn
  }
}
