// @ts-expect-error — net-snmp has no type declarations
import * as snmp from "net-snmp"
import { execFile } from "node:child_process"
import { logger } from "../logger"
import type {
  NetworkDeviceAdapter,
  NetworkDeviceAdapterConfig,
  ArpEntry,
  DhcpLease,
  NetworkInterface,
} from "./network-device-adapter"

// Standard SNMP OIDs
const OID = {
  // ipNetToMediaTable — ARP cache
  ipNetToMediaPhysAddress: "1.3.6.1.2.1.4.22.1.2",
  ipNetToMediaNetAddress: "1.3.6.1.2.1.4.22.1.3",
  ipNetToMediaType: "1.3.6.1.2.1.4.22.1.4",
  // ifTable — interfaces
  ifDescr: "1.3.6.1.2.1.2.2.1.2",
  ifSpeed: "1.3.6.1.2.1.2.2.1.5",
  ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
  // ipAddrTable — IP addresses on interfaces
  ipAdEntAddr: "1.3.6.1.2.1.4.20.1.1",
  ipAdEntIfIndex: "1.3.6.1.2.1.4.20.1.2",
  ipAdEntNetMask: "1.3.6.1.2.1.4.20.1.3",
} as const

function formatMac(buffer: Buffer): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(":")
}

export class SnmpNetworkDeviceAdapter implements NetworkDeviceAdapter {
  readonly type: string = "snmp-generic"
  protected config: NetworkDeviceAdapterConfig

  constructor(config: NetworkDeviceAdapterConfig) {
    this.config = config
  }

  protected createSession(): snmp.Session {
    const community = this.config.credentials.community ?? "public"
    return snmp.createSession(this.config.host, community, {
      port: this.config.port ?? 161,
      timeout: this.config.timeout ?? 5000,
    })
  }

  protected subtree(session: snmp.Session, oid: string): Promise<snmp.Varbind[]> {
    return new Promise((resolve, reject) => {
      const results: snmp.Varbind[] = []
      session.subtree(
        oid,
        (varbinds: snmp.Varbind[]) => {
          results.push(...varbinds)
        },
        (error: Error | undefined) => {
          if (error) reject(error)
          else resolve(results)
        }
      )
    })
  }

  async getArpTable(): Promise<ArpEntry[]> {
    const session = this.createSession()
    try {
      const [macVarbinds, ipVarbinds] = await Promise.all([
        this.subtree(session, OID.ipNetToMediaPhysAddress),
        this.subtree(session, OID.ipNetToMediaNetAddress),
      ])

      // Index by the OID suffix (ifIndex.ipAddress)
      const macByKey = new Map<string, string>()
      for (const vb of macVarbinds) {
        const suffix = vb.oid.substring(OID.ipNetToMediaPhysAddress.length + 1)
        macByKey.set(suffix, formatMac(vb.value as Buffer))
      }

      const entries: ArpEntry[] = []
      for (const vb of ipVarbinds) {
        const suffix = vb.oid.substring(OID.ipNetToMediaNetAddress.length + 1)
        const ip = vb.value?.toString()
        const mac = macByKey.get(suffix)
        if (ip && mac) {
          const ifIndex = suffix.split(".")[0]
          entries.push({
            ipAddress: ip,
            macAddress: mac,
            interface: ifIndex ? `if${ifIndex}` : undefined,
          })
        }
      }

      return entries
    } catch (error) {
      logger.error({ error, host: this.config.host }, "SNMP getArpTable failed")
      return []
    } finally {
      session.close()
    }
  }

  async getDhcpLeases(): Promise<DhcpLease[]> {
    // DHCP leases are not in standard SNMP MIBs
    // Subclasses (GajShield, etc.) should override this
    logger.info("SNMP generic adapter: DHCP leases not available via standard MIBs")
    return []
  }

  async getInterfaces(): Promise<NetworkInterface[]> {
    const session = this.createSession()
    try {
      const [descrVarbinds, speedVarbinds, statusVarbinds] =
        await Promise.all([
          this.subtree(session, OID.ifDescr),
          this.subtree(session, OID.ifSpeed),
          this.subtree(session, OID.ifOperStatus),
        ])

      const interfaces = new Map<string, NetworkInterface>()

      for (const vb of descrVarbinds) {
        const idx = vb.oid.split(".").pop()!
        interfaces.set(idx, {
          name: vb.value?.toString() ?? `if${idx}`,
          status: "down",
        })
      }

      for (const vb of speedVarbinds) {
        const idx = vb.oid.split(".").pop()!
        const iface = interfaces.get(idx)
        if (iface) {
          const speedBps = Number(vb.value)
          iface.speed = speedBps >= 1e9
            ? `${(speedBps / 1e9).toFixed(0)}Gbps`
            : `${(speedBps / 1e6).toFixed(0)}Mbps`
        }
      }

      for (const vb of statusVarbinds) {
        const idx = vb.oid.split(".").pop()!
        const iface = interfaces.get(idx)
        if (iface) {
          iface.status = Number(vb.value) === 1 ? "up" : "down"
        }
      }

      return [...interfaces.values()]
    } catch (error) {
      logger.error({ error, host: this.config.host }, "SNMP getInterfaces failed")
      return []
    } finally {
      session.close()
    }
  }

  async ping(address: string): Promise<boolean> {
    // Validate address is a valid IP (no shell injection via execFile anyway)
    if (!/^[\d.]+$/.test(address) && !/^[\da-f:]+$/i.test(address)) {
      return false
    }

    return new Promise((resolve) => {
      const args = process.platform === "linux"
        ? ["-c", "1", "-W", "2", address]
        : ["-c", "1", "-t", "2", address]

      execFile("ping", args, (error) => {
        resolve(!error)
      })
    })
  }
}
