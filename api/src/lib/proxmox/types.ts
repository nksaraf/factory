/**
 * Proxmox API Types
 * Based on the Proxmox VE API documentation
 */

// Node information from /api2/json/nodes
export interface ProxmoxNode {
  node: string
  status: "online" | "offline" | "unknown"
  cpu: number // CPU usage (0-1)
  maxcpu: number
  mem: number // Memory used in bytes
  maxmem: number
  disk: number // Disk used in bytes
  maxdisk: number
  uptime: number // Uptime in seconds
  level?: string
  ssl_fingerprint?: string
}

// Detailed node status from /api2/json/nodes/{node}/status
export interface ProxmoxNodeStatus {
  uptime: number
  cpu: number
  wait: number
  cpuinfo: {
    cpus: number
    cores: number
    sockets: number
    model: string
    mhz: string
    hvm: string
    user_hz: number
  }
  memory: {
    total: number
    used: number
    free: number
  }
  rootfs: {
    total: number
    used: number
    free: number
    avail: number
  }
  swap: {
    total: number
    used: number
    free: number
  }
  ksm?: {
    shared: number
  }
  kversion?: string
  pveversion?: string
  idle?: number
  loadavg?: [number, number, number]
}

// VM/Container from /api2/json/nodes/{node}/qemu or /lxc
export interface ProxmoxVmInfo {
  vmid: number
  name: string
  status: "running" | "stopped" | "paused"
  type?: "qemu" | "lxc"
  node?: string // Added during processing
  cpu?: number // CPU usage (0-1)
  cpus?: number // Number of CPUs
  mem?: number // Memory used in bytes
  maxmem?: number // Max memory in bytes
  disk?: number // Disk used in bytes
  maxdisk?: number // Max disk in bytes
  netin?: number
  netout?: number
  diskread?: number
  diskwrite?: number
  uptime?: number
  template?: 0 | 1 // 1 if this is a template
  tags?: string
  lock?: string
}

// VM Config from /api2/json/nodes/{node}/qemu/{vmid}/config
export interface ProxmoxVmConfig {
  name?: string
  description?: string
  memory?: number
  cores?: number
  sockets?: number
  cpu?: string
  ostype?: string
  machine?: string
  bios?: "seabios" | "ovmf"
  boot?: string
  bootdisk?: string
  agent?: string
  onboot?: 0 | 1
  startup?: string
  protection?: 0 | 1
  // Network interfaces (net0, net1, etc.)
  [key: `net${number}`]: string
  // Disks (scsi0, virtio0, ide0, etc.)
  [key: `scsi${number}`]: string
  [key: `virtio${number}`]: string
  [key: `ide${number}`]: string
  // Cloud-init
  cicustom?: string
  cipassword?: string
  citype?: string
  ciuser?: string
  ipconfig0?: string
  ipconfig1?: string
  nameserver?: string
  searchdomain?: string
  sshkeys?: string
}

// Task from /api2/json/nodes/{node}/tasks
export interface ProxmoxTask {
  upid: string
  node: string
  pid: number
  pstart: number
  starttime: number
  type: string
  user: string
  status?: string
  exitstatus?: string
}

// Cluster status from /api2/json/cluster/status
export interface ProxmoxClusterStatus {
  id: string
  name: string
  type: "cluster" | "node"
  nodeid?: number
  version?: number
  level?: string
  local?: 0 | 1
  online?: 0 | 1
  quorate?: 0 | 1
  nodes?: number
  ip?: string
  status?: string
}

// Cluster resource from /api2/json/cluster/resources
export interface ProxmoxClusterResource {
  id: string
  type: "node" | "qemu" | "lxc" | "storage" | "pool" | "sdn"
  node?: string
  vmid?: number
  name?: string
  status?: string
  cpu?: number // CPU usage (0-1)
  cpus?: number // Number of CPUs
  mem?: number // Memory used in bytes
  maxmem?: number // Max memory in bytes
  disk?: number // Disk used in bytes
  maxdisk?: number // Max disk in bytes
  uptime?: number
  template?: 0 | 1
  pool?: string
  storage?: string
  content?: string
  shared?: 0 | 1
  [key: string]: unknown // Allow additional properties
}

// Storage from /api2/json/nodes/{node}/storage
export interface ProxmoxStorage {
  storage: string
  type: string
  content: string
  active: 0 | 1
  enabled: 0 | 1
  shared: 0 | 1
  total: number
  used: number
  avail: number
  used_fraction: number
}

// API Response wrapper
export interface ProxmoxApiResponse<T> {
  data: T
}

// Clone options
export interface ProxmoxCloneOptions {
  newid: number
  name?: string
  description?: string
  target?: string // Target node
  pool?: string
  storage?: string
  format?: "raw" | "qcow2" | "vmdk"
  full?: 0 | 1 // Full clone (1) or linked clone (0)
  snapname?: string
}

// Cloud-init config for provisioning
export interface CloudInitConfig {
  ciuser?: string
  cipassword?: string
  sshkeys?: string
  ipconfig0?: string // e.g., "ip=192.168.1.100/24,gw=192.168.1.1"
  nameserver?: string
  searchdomain?: string
}

// Credentials for connecting
export interface ProxmoxCredentials {
  host: string
  port?: number // Default: 8006
  tokenId: string
  tokenSecret: string
  fingerprint?: string
}

// Connection test result
export interface ConnectionTestResult {
  success: boolean
  version?: string
  nodes?: string[]
  error?: string
}

// Guest agent network interface data
export interface GuestNetworkInterface {
  name: string
  "hardware-address": string
  "ip-addresses": Array<{
    "ip-address": string
    "ip-address-type": "ipv4" | "ipv6"
    prefix: number
  }>
  statistics?: {
    "rx-bytes": number
    "tx-bytes": number
    "rx-packets": number
    "tx-packets": number
  }
}
