import { logger } from "../logger"
import type {
  NetworkDeviceAdapter,
  ArpEntry,
  DhcpLease,
  NetworkInterface,
} from "./network-device-adapter"

export class NoopNetworkDeviceAdapter implements NetworkDeviceAdapter {
  readonly type = "noop"

  async getArpTable(): Promise<ArpEntry[]> {
    logger.info("noop network device adapter: getArpTable")
    return []
  }

  async getDhcpLeases(): Promise<DhcpLease[]> {
    logger.info("noop network device adapter: getDhcpLeases")
    return []
  }

  async getInterfaces(): Promise<NetworkInterface[]> {
    logger.info("noop network device adapter: getInterfaces")
    return []
  }

  async ping(_address: string): Promise<boolean> {
    logger.info("noop network device adapter: ping")
    return false
  }
}
