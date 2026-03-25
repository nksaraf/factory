/**
 * IP extraction helpers for Proxmox VMs
 * Ported from lepton-cloud sync.ts
 */

import type { ProxmoxClient } from "./client";
import type { ProxmoxVmConfig, GuestNetworkInterface } from "./types";

/**
 * Extract IP address from Proxmox IP config string
 * Format: "ip=192.168.1.100/24,gw=192.168.1.1" or "ip=dhcp"
 */
export function extractIpFromConfig(ipConfig: string | undefined): string | null {
  if (!ipConfig) return null;
  if (ipConfig.includes("ip=dhcp")) return null;

  const ipMatch = ipConfig.match(/ip=([^,]+)/);
  if (!ipMatch) return null;

  const ip = ipMatch[1].split("/")[0];
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  return ipRegex.test(ip) ? ip : null;
}

/**
 * Get primary IP address from VM config
 * Checks ipconfig0, ipconfig1, etc. in order
 */
export function getPrimaryIpFromConfig(config: ProxmoxVmConfig): string | null {
  if (config.ipconfig0) {
    const ip = extractIpFromConfig(config.ipconfig0);
    if (ip) return ip;
  }
  if (config.ipconfig1) {
    const ip = extractIpFromConfig(config.ipconfig1);
    if (ip) return ip;
  }
  for (let i = 2; i < 10; i++) {
    const ipConfigKey = `ipconfig${i}` as keyof ProxmoxVmConfig;
    const ipConfig = config[ipConfigKey];
    if (typeof ipConfig === "string") {
      const ip = extractIpFromConfig(ipConfig);
      if (ip) return ip;
    }
  }
  return null;
}

/**
 * Check if an IP address is a loopback or Docker bridge address
 */
function isPrivateOrLoopback(ip: string): boolean {
  if (ip === "127.0.0.1" || ip.startsWith("127.")) return true;
  if (ip.startsWith("172.17.") || ip.startsWith("172.18.")) return true;
  if (ip.startsWith("fe80::")) return true;
  return false;
}

/**
 * Extract primary IPv4 address from guest agent network interfaces
 * Returns the first non-loopback, non-Docker IPv4 address found
 */
function extractIpFromGuestInterfaces(interfaces: GuestNetworkInterface[]): string | null {
  for (const iface of interfaces) {
    if (iface.name === "lo") continue;
    for (const ipAddr of iface["ip-addresses"]) {
      if (ipAddr["ip-address-type"] === "ipv4") {
        const ip = ipAddr["ip-address"];
        if (!isPrivateOrLoopback(ip)) {
          return ip;
        }
      }
    }
  }
  return null;
}

/**
 * Get IP address from VM using QEMU guest agent via Proxmox API
 * Uses GET /nodes/{node}/qemu/{vmid}/agent/network-get-interfaces
 */
export async function getIpFromGuestAgent(
  client: ProxmoxClient,
  nodeName: string,
  vmid: number
): Promise<string | null> {
  try {
    const hasAgent = await client.checkQemuAgent(nodeName, vmid);
    if (!hasAgent) return null;

    const interfaces = await client.getGuestNetworkInterfaces(nodeName, vmid);
    return extractIpFromGuestInterfaces(interfaces);
  } catch {
    return null;
  }
}
