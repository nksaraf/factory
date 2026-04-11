import { logger } from "../logger"
import { SnmpNetworkDeviceAdapter } from "./network-device-adapter-snmp"
import type {
  NetworkDeviceAdapterConfig,
  DhcpLease,
} from "./network-device-adapter"

/**
 * GajShield firewall/gateway adapter.
 *
 * Extends the SNMP generic adapter for standard operations (ARP, interfaces, ping).
 * Overrides getDhcpLeases() to attempt GajShield-specific retrieval:
 *   1. REST API probe (if firmware supports it)
 *   2. Falls back to empty with a warning
 *
 * GajShield interface details vary by firmware version. This adapter is designed
 * to degrade gracefully — it logs what it can't access and returns partial data.
 */
export class GajShieldNetworkDeviceAdapter extends SnmpNetworkDeviceAdapter {
  override readonly type: string = "gajshield"

  constructor(config: NetworkDeviceAdapterConfig) {
    super(config)
  }

  override async getDhcpLeases(): Promise<DhcpLease[]> {
    // Attempt REST API if credentials support it
    if (this.config.credentials.apiKey || this.config.credentials.username) {
      try {
        return await this.fetchDhcpLeasesViaRest()
      } catch (error) {
        logger.warn(
          { error, host: this.config.host },
          "GajShield REST API DHCP fetch failed, falling back"
        )
      }
    }

    logger.info(
      { host: this.config.host },
      "GajShield: DHCP lease retrieval not available — configure REST API credentials or check firmware version"
    )
    return []
  }

  private async fetchDhcpLeasesViaRest(): Promise<DhcpLease[]> {
    const { host, credentials } = this.config
    const port = this.config.port ?? 443
    const baseUrl = `https://${host}:${port}`

    // GajShield management APIs vary by firmware — try known endpoints
    const endpoints = [
      "/api/v1/dhcp/leases",
      "/api/dhcp/leases",
      "/cgi-bin/dhcp_leases",
    ]

    const headers: Record<string, string> = {
      Accept: "application/json",
    }

    if (credentials.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`
    } else if (credentials.username && credentials.password) {
      headers["Authorization"] =
        `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`
    }

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          headers,
          signal: AbortSignal.timeout(this.config.timeout ?? 10000),
        })

        if (!response.ok) continue

        const body = (await response.json()) as any
        const leases = Array.isArray(body)
          ? body
          : (body.leases ?? body.data ?? [])

        return leases
          .map((lease: any) => ({
            ipAddress: lease.ip ?? lease.ipAddress ?? lease.ip_address,
            macAddress:
              lease.mac ?? lease.macAddress ?? lease.mac_address ?? "",
            hostname: lease.hostname ?? lease.name,
            leaseStart: lease.start ? new Date(lease.start) : undefined,
            leaseEnd: lease.end ? new Date(lease.end) : undefined,
            status: this.mapLeaseStatus(lease.status ?? lease.state),
          }))
          .filter((l: DhcpLease) => l.ipAddress)
      } catch {
        // Try next endpoint
        continue
      }
    }

    throw new Error("No working DHCP lease endpoint found")
  }

  private mapLeaseStatus(
    raw: string | undefined
  ): "active" | "expired" | "reserved" {
    if (!raw) return "active"
    const normalized = raw.toLowerCase()
    if (normalized.includes("expir")) return "expired"
    if (normalized.includes("reserv") || normalized.includes("static"))
      return "reserved"
    return "active"
  }
}
