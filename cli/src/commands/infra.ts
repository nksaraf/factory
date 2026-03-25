import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";

function jsonOut(flags: Record<string, unknown>, data: unknown) {
  const f = toDxFlags(flags);
  if (f.json) {
    console.log(JSON.stringify({ success: true, data }, null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function apiCall(
  flags: Record<string, unknown>,
  fn: () => Promise<{ data: unknown; error: unknown }>
): Promise<unknown> {
  const f = toDxFlags(flags);
  try {
    const res = await fn();
    if (res.error) {
      exitWithError(f, `API error: ${JSON.stringify(res.error)}`);
    }
    return res.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    exitWithError(f, msg);
  }
}

// Eden client type doesn't include infra routes due to conditional plugin
// registration in factory.api.ts. Routes work at runtime. Use `any` for path access.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getInfraApi(): Promise<any> {
  return getFactoryClient();
}

export function infraCommand(app: DxBase) {
  return app
    .sub("infra")
    .meta({ description: "Infrastructure management" })

    // --- Providers ---
    .command("provider", (c) =>
      c
        .meta({ description: "Manage infrastructure providers" })
        .command("list", (c) =>
          c
            .meta({ description: "List providers" })
            .flags({
              status: { type: "string", description: "Filter by status" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.providers.get({
                  query: { status: flags.status as string | undefined },
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get provider by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Provider ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.providers({ id: args.id }).get()
              );
              jsonOut(flags, result);
            })
        )
        .command("create", (c) =>
          c
            .meta({ description: "Create a provider" })
            .args([{ name: "name", type: "string", required: true, description: "Provider name" }])
            .flags({
              type: { type: "string", description: "Provider type (proxmox, hetzner, aws, gcp)" },
            })
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.providers.post({
                  name: args.name,
                  providerType: (flags.type as string) ?? "proxmox",
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("sync", (c) =>
          c
            .meta({ description: "Sync provider inventory" })
            .args([{ name: "id", type: "string", required: true, description: "Provider ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.providers({ id: args.id }).sync.post()
              );
              jsonOut(flags, result);
            })
        )
    )

    // --- Regions ---
    .command("region", (c) =>
      c
        .meta({ description: "Manage regions" })
        .command("list", (c) =>
          c
            .meta({ description: "List regions" })
            .flags({
              providerId: { type: "string", description: "Filter by provider ID" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.regions.get({
                  query: { providerId: flags.providerId as string | undefined },
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get region by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Region ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.regions({ id: args.id }).get()
              );
              jsonOut(flags, result);
            })
        )
        .command("create", (c) =>
          c
            .meta({ description: "Create a region" })
            .args([{ name: "name", type: "string", required: true, description: "Region name" }])
            .flags({
              displayName: { type: "string", description: "Display name" },
              slug: { type: "string", description: "URL slug" },
              country: { type: "string", description: "Country code" },
              city: { type: "string", description: "City" },
              providerId: { type: "string", description: "Provider ID" },
            })
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.regions.post({
                  name: args.name,
                  displayName: (flags.displayName as string) ?? args.name,
                  slug: flags.slug as string | undefined,
                  country: flags.country as string | undefined,
                  city: flags.city as string | undefined,
                  providerId: flags.providerId as string | undefined,
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("delete", (c) =>
          c
            .meta({ description: "Delete a region" })
            .args([{ name: "id", type: "string", required: true, description: "Region ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.regions({ id: args.id }).delete()
              );
              jsonOut(flags, result);
            })
        )
    )

    // --- Clusters ---
    .command("cluster", (c) =>
      c
        .meta({ description: "Manage Kube clusters" })
        .command("list", (c) =>
          c
            .meta({ description: "List clusters" })
            .flags({
              providerId: { type: "string", description: "Filter by provider" },
              status: { type: "string", description: "Filter by status" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.clusters.get({
                  query: {
                    providerId: flags.providerId as string | undefined,
                    status: flags.status as string | undefined,
                  },
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get cluster by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Cluster ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.clusters({ id: args.id }).get()
              );
              jsonOut(flags, result);
            })
        )
        .command("create", (c) =>
          c
            .meta({ description: "Create a cluster" })
            .args([{ name: "name", type: "string", required: true, description: "Cluster name" }])
            .flags({
              providerId: { type: "string", required: true, description: "Provider ID" },
            })
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.clusters.post({
                  name: args.name,
                  providerId: flags.providerId as string,
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("destroy", (c) =>
          c
            .meta({ description: "Destroy a cluster" })
            .args([{ name: "id", type: "string", required: true, description: "Cluster ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.clusters({ id: args.id }).delete()
              );
              jsonOut(flags, result);
            })
        )
    )

    // --- VMs ---
    .command("vm", (c) =>
      c
        .meta({ description: "Manage virtual machines" })
        .command("list", (c) =>
          c
            .meta({ description: "List VMs" })
            .flags({
              providerId: { type: "string", description: "Filter by provider" },
              status: { type: "string", description: "Filter by status" },
              hostId: { type: "string", description: "Filter by host" },
              clusterId: { type: "string", description: "Filter by cluster" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.vms.get({
                  query: {
                    providerId: flags.providerId as string | undefined,
                    status: flags.status as string | undefined,
                    hostId: flags.hostId as string | undefined,
                    clusterId: flags.clusterId as string | undefined,
                  },
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get VM by ID" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.vms({ id: args.id }).get()
              );
              jsonOut(flags, result);
            })
        )
        .command("create", (c) =>
          c
            .meta({ description: "Create a VM" })
            .args([{ name: "name", type: "string", required: true, description: "VM name" }])
            .flags({
              providerId: { type: "string", required: true, description: "Provider ID" },
              cpu: { type: "number", description: "CPU cores (default: 2)" },
              memoryMb: { type: "number", description: "Memory in MB (default: 4096)" },
              diskGb: { type: "number", description: "Disk in GB (default: 50)" },
              hostId: { type: "string", description: "Host ID" },
              clusterId: { type: "string", description: "Cluster ID" },
            })
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.vms.post({
                  name: args.name,
                  providerId: flags.providerId as string,
                  cpu: (flags.cpu as number) ?? 2,
                  memoryMb: (flags.memoryMb as number) ?? 4096,
                  diskGb: (flags.diskGb as number) ?? 50,
                  hostId: flags.hostId as string | undefined,
                  clusterId: flags.clusterId as string | undefined,
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("start", (c) =>
          c
            .meta({ description: "Start a VM" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.vms({ id: args.id }).start.post()
              );
              jsonOut(flags, result);
            })
        )
        .command("stop", (c) =>
          c
            .meta({ description: "Stop a VM" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.vms({ id: args.id }).stop.post()
              );
              jsonOut(flags, result);
            })
        )
        .command("restart", (c) =>
          c
            .meta({ description: "Restart a VM" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.vms({ id: args.id }).restart.post()
              );
              jsonOut(flags, result);
            })
        )
        .command("snapshot", (c) =>
          c
            .meta({ description: "Snapshot a VM" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.vms({ id: args.id }).snapshot.post()
              );
              jsonOut(flags, result);
            })
        )
        .command("destroy", (c) =>
          c
            .meta({ description: "Destroy a VM" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.vms({ id: args.id }).delete()
              );
              jsonOut(flags, result);
            })
        )
    )

    // --- Hosts ---
    .command("host", (c) =>
      c
        .meta({ description: "Manage physical hosts" })
        .command("list", (c) =>
          c
            .meta({ description: "List hosts" })
            .flags({
              providerId: { type: "string", description: "Filter by provider" },
              datacenterId: { type: "string", description: "Filter by datacenter" },
              status: { type: "string", description: "Filter by status" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.hosts.get({
                  query: {
                    providerId: flags.providerId as string | undefined,
                    datacenterId: flags.datacenterId as string | undefined,
                    status: flags.status as string | undefined,
                  },
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get host by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Host ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.hosts({ id: args.id }).get()
              );
              jsonOut(flags, result);
            })
        )
        .command("add", (c) =>
          c
            .meta({ description: "Add a host" })
            .args([{ name: "name", type: "string", required: true, description: "Host name" }])
            .flags({
              providerId: { type: "string", required: true, description: "Provider ID" },
              cpuCores: { type: "number", required: true, description: "CPU cores" },
              memoryMb: { type: "number", required: true, description: "Memory in MB" },
              diskGb: { type: "number", required: true, description: "Disk in GB" },
              datacenterId: { type: "string", description: "Datacenter ID" },
              ipAddress: { type: "string", description: "IP address" },
            })
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.hosts.post({
                  name: args.name,
                  providerId: flags.providerId as string,
                  cpuCores: flags.cpuCores as number,
                  memoryMb: flags.memoryMb as number,
                  diskGb: flags.diskGb as number,
                  datacenterId: flags.datacenterId as string | undefined,
                  ipAddress: flags.ipAddress as string | undefined,
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("remove", (c) =>
          c
            .meta({ description: "Remove a host" })
            .args([{ name: "id", type: "string", required: true, description: "Host ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.hosts({ id: args.id }).delete()
              );
              jsonOut(flags, result);
            })
        )
    )

    // --- Kube Nodes ---
    .command("kube-node", (c) =>
      c
        .meta({ description: "Manage Kube cluster nodes" })
        .command("list", (c) =>
          c
            .meta({ description: "List nodes in a cluster" })
            .flags({
              clusterId: { type: "string", required: true, description: "Cluster ID" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra["kube-nodes"].get({
                  query: { clusterId: flags.clusterId as string },
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get node by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Node ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra["kube-nodes"]({ id: args.id }).get()
              );
              jsonOut(flags, result);
            })
        )
        .command("add", (c) =>
          c
            .meta({ description: "Add a node to a cluster" })
            .args([{ name: "name", type: "string", required: true, description: "Node name" }])
            .flags({
              clusterId: { type: "string", required: true, description: "Cluster ID" },
              role: { type: "string", description: "Node role (server or agent, default: agent)" },
              ipAddress: { type: "string", required: true, description: "Node IP address" },
              vmId: { type: "string", description: "VM ID for this node" },
            })
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra["kube-nodes"].post({
                  name: args.name,
                  clusterId: flags.clusterId as string,
                  role: (flags.role as string) ?? "agent",
                  ipAddress: flags.ipAddress as string,
                  vmId: flags.vmId as string | undefined,
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("remove", (c) =>
          c
            .meta({ description: "Remove a node" })
            .args([{ name: "id", type: "string", required: true, description: "Node ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra["kube-nodes"]({ id: args.id }).delete()
              );
              jsonOut(flags, result);
            })
        )
        .command("pause", (c) =>
          c
            .meta({ description: "Pause scheduling on a node" })
            .args([{ name: "id", type: "string", required: true, description: "Node ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra["kube-nodes"]({ id: args.id }).pause.post()
              );
              jsonOut(flags, result);
            })
        )
        .command("resume", (c) =>
          c
            .meta({ description: "Resume scheduling on a node" })
            .args([{ name: "id", type: "string", required: true, description: "Node ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra["kube-nodes"]({ id: args.id }).resume.post()
              );
              jsonOut(flags, result);
            })
        )
        .command("evacuate", (c) =>
          c
            .meta({ description: "Evacuate all work off a node" })
            .args([{ name: "id", type: "string", required: true, description: "Node ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra["kube-nodes"]({ id: args.id }).evacuate.post()
              );
              jsonOut(flags, result);
            })
        )
    )

    // --- Subnets ---
    .command("subnet", (c) =>
      c
        .meta({ description: "Manage network subnets" })
        .command("list", (c) =>
          c
            .meta({ description: "List subnets" })
            .flags({
              datacenterId: { type: "string", description: "Filter by datacenter" },
              subnetType: { type: "string", description: "Filter by type" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.subnets.get({
                  query: {
                    datacenterId: flags.datacenterId as string | undefined,
                    subnetType: flags.subnetType as string | undefined,
                  },
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get subnet by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Subnet ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.subnets({ id: args.id }).get()
              );
              jsonOut(flags, result);
            })
        )
        .command("create", (c) =>
          c
            .meta({ description: "Create a subnet" })
            .args([{ name: "cidr", type: "string", required: true, description: "CIDR block (e.g. 10.0.1.0/24)" }])
            .flags({
              gateway: { type: "string", description: "Gateway address" },
              subnetType: { type: "string", description: "Subnet type (vm, management, storage, public, private)" },
              vlanId: { type: "number", description: "VLAN ID" },
              datacenterId: { type: "string", description: "Datacenter ID" },
              description: { type: "string", description: "Description" },
            })
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.subnets.post({
                  cidr: args.cidr,
                  gateway: flags.gateway as string | undefined,
                  subnetType: (flags.subnetType as string) ?? "vm",
                  vlanId: flags.vlanId as number | undefined,
                  datacenterId: flags.datacenterId as string | undefined,
                  description: flags.description as string | undefined,
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("delete", (c) =>
          c
            .meta({ description: "Delete a subnet" })
            .args([{ name: "id", type: "string", required: true, description: "Subnet ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.subnets({ id: args.id }).delete()
              );
              jsonOut(flags, result);
            })
        )
    )

    // --- IPs ---
    .command("ip", (c) =>
      c
        .meta({ description: "IP address management" })
        .command("list", (c) =>
          c
            .meta({ description: "List IPs" })
            .flags({
              subnetId: { type: "string", description: "Filter by subnet" },
              status: { type: "string", description: "Filter by status" },
              assignedToType: { type: "string", description: "Filter by assigned entity type" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.ips.get({
                  query: {
                    subnetId: flags.subnetId as string | undefined,
                    status: flags.status as string | undefined,
                    assignedToType: flags.assignedToType as string | undefined,
                  },
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("available", (c) =>
          c
            .meta({ description: "List free/unassigned IPs" })
            .flags({
              subnetId: { type: "string", description: "Filter by subnet" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.ips.available.get({
                  query: { subnetId: flags.subnetId as string | undefined },
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("stats", (c) =>
          c
            .meta({ description: "IPAM statistics" })
            .flags({
              subnetId: { type: "string", description: "Filter by subnet" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.ips.stats.get({
                  query: { subnetId: flags.subnetId as string | undefined },
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("register", (c) =>
          c
            .meta({ description: "Register an IP address" })
            .args([{ name: "address", type: "string", required: true, description: "IP address" }])
            .flags({
              subnetId: { type: "string", description: "Subnet ID" },
            })
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.ips.register.post({
                  address: args.address,
                  subnetId: flags.subnetId as string | undefined,
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("assign", (c) =>
          c
            .meta({ description: "Assign an IP to an entity" })
            .args([{ name: "id", type: "string", required: true, description: "IP address ID" }])
            .flags({
              toType: { type: "string", required: true, description: "Entity type (vm, host, kube_node, cluster, service)" },
              toId: { type: "string", required: true, description: "Entity ID" },
              hostname: { type: "string", description: "Hostname" },
              purpose: { type: "string", description: "Purpose (management, storage, application)" },
            })
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.ips({ id: args.id }).assign.post({
                  assignedToType: flags.toType as string,
                  assignedToId: flags.toId as string,
                  hostname: flags.hostname as string | undefined,
                  purpose: flags.purpose as string | undefined,
                })
              );
              jsonOut(flags, result);
            })
        )
        .command("release", (c) =>
          c
            .meta({ description: "Release an IP back to available" })
            .args([{ name: "id", type: "string", required: true, description: "IP address ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.ips({ id: args.id }).release.post()
              );
              jsonOut(flags, result);
            })
        )
        .command("lookup", (c) =>
          c
            .meta({ description: "Look up an IP by address" })
            .args([{ name: "address", type: "string", required: true, description: "IP address to find" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.ips.lookup.post({
                  address: args.address,
                })
              );
              jsonOut(flags, result);
            })
        )
    )

    // --- Assets ---
    .command("asset", (c) =>
      c
        .meta({ description: "Unified infrastructure assets" })
        .command("list", (c) =>
          c
            .meta({ description: "List all infra assets" })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.assets.get()
              );
              jsonOut(flags, result);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get asset by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Asset ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.infra.assets({ id: args.id }).get()
              );
              jsonOut(flags, result);
            })
        )
    );
}
