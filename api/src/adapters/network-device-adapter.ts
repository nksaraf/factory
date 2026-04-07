export type NetworkDeviceType = "gajshield" | "snmp-generic" | "noop";

export interface ArpEntry {
  ipAddress: string;
  macAddress: string;
  interface?: string;
  hostname?: string;
}

export interface DhcpLease {
  ipAddress: string;
  macAddress: string;
  hostname?: string;
  leaseStart?: Date;
  leaseEnd?: Date;
  status: "active" | "expired" | "reserved";
}

export interface NetworkInterface {
  name: string;
  ipAddress?: string;
  netmask?: string;
  status: "up" | "down";
  speed?: string;
}

export interface NetworkDeviceAdapterConfig {
  host: string;
  port?: number;
  credentials: {
    community?: string;     // SNMP v2c community string
    username?: string;       // SNMP v3 or REST
    password?: string;
    apiKey?: string;
  };
  timeout?: number;
}

export interface NetworkDeviceAdapter {
  readonly type: string;
  getArpTable(): Promise<ArpEntry[]>;
  getDhcpLeases(): Promise<DhcpLease[]>;
  getInterfaces(): Promise<NetworkInterface[]>;
  ping(address: string): Promise<boolean>;
}
