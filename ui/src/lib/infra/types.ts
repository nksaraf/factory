// ui/src/lib/infra/types.ts

export interface Provider {
  id: string
  name: string
  slug: string
  providerType: string
  url: string | null
  status: string
  providerKind: string
  createdAt: string
}

export interface Cluster {
  id: string
  name: string
  slug: string
  providerId: string
  status: string
  kubeconfigRef: string | null
  createdAt: string
}

export interface Region {
  id: string
  name: string
  displayName: string
  slug: string
  country: string | null
  city: string | null
  timezone: string | null
  providerId: string | null
  createdAt: string
}

export interface Datacenter {
  id: string
  name: string
  displayName: string
  slug: string
  regionId: string
  availabilityZone: string | null
  address: string | null
  createdAt: string
}

export interface Host {
  id: string
  name: string
  slug: string
  hostname: string | null
  hostType: string
  providerId: string
  datacenterId: string | null
  ipAddress: string | null
  ipmiAddress: string | null
  status: string
  osType: string
  accessMethod: string
  cpuCores: number
  memoryMb: number
  diskGb: number
  rackLocation: string | null
  createdAt: string
}

export interface VM {
  id: string
  name: string
  slug: string
  providerId: string
  datacenterId: string | null
  hostId: string | null
  clusterId: string | null
  proxmoxClusterId: string | null
  proxmoxVmid: number | null
  vmType: string
  status: string
  osType: string
  accessMethod: string
  accessUser: string | null
  cpu: number
  memoryMb: number
  diskGb: number
  ipAddress: string | null
  createdAt: string
}

export interface KubeNode {
  id: string
  name: string
  slug: string
  clusterId: string
  vmId: string | null
  role: string
  status: string
  ipAddress: string
  createdAt: string
}

export interface Subnet {
  id: string
  cidr: string
  gateway: string | null
  netmask: string | null
  vlanId: number | null
  vlanName: string | null
  datacenterId: string | null
  subnetType: string
  description: string | null
  dnsServers: string | null
  dnsDomain: string | null
  createdAt: string
}

export interface IpAddress {
  id: string
  address: string
  subnetId: string | null
  assignedToKind: string | null
  assignedToId: string | null
  status: string
  dnsName: string | null
  role: string | null
  createdAt: string
}

export interface ProxmoxCluster {
  id: string
  name: string
  slug: string
  providerId: string
  apiHost: string
  apiPort: number
  syncStatus: string
  lastSyncAt: string | null
  syncError: string | null
  createdAt: string
}
