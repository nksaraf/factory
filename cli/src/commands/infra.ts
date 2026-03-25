import type { DxBase } from "../dx-root.js";

import { getFactoryClient } from "../client.js";
import { printTable } from "../output.js";
import { toDxFlags } from "./dx-flags.js";
import {
  type ColumnOpt,
  apiCall,
  colorStatus,
  tableOrJson,
  detailView,
  actionResult,
  styleBold,
  styleMuted,
  styleSuccess,
} from "./list-helpers.js";

async function getInfraApi() {
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
                api.api.v1.factory.infra.providers.get({
                  query: { status: flags.status as string | undefined },
                })
              );
              tableOrJson(flags, result, ["ID", "Name", "Type", "Kind", "Status"], (r) => [
                styleMuted(String(r.providerId ?? "")),
                styleBold(String(r.name ?? "")),
                String(r.providerType ?? ""),
                String(r.providerKind ?? ""),
                colorStatus(String(r.status ?? "")),
              ]);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get provider by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Provider ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.providers({ id: args.id }).get()
              );
              detailView(flags, result, [
                ["ID", (r) => styleMuted(String(r.providerId ?? ""))],
                ["Name", (r) => styleBold(String(r.name ?? ""))],
                ["Type", (r) => String(r.providerType ?? "")],
                ["Kind", (r) => String(r.providerKind ?? "")],
                ["Status", (r) => colorStatus(String(r.status ?? ""))],
                ["Created", (r) => String(r.createdAt ?? "")],
              ]);
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
                api.api.v1.factory.infra.providers.post({
                  name: args.name,
                  providerType: (flags.type as string) ?? "proxmox",
                })
              );
              actionResult(flags, result, styleSuccess(`Provider "${args.name}" created.`));
            })
        )
        .command("sync", (c) =>
          c
            .meta({ description: "Sync provider inventory" })
            .args([{ name: "id", type: "string", required: true, description: "Provider ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.providers({ id: args.id }).sync.post()
              );
              actionResult(flags, result, styleSuccess(`Provider ${args.id} sync started.`));
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
                api.api.v1.factory.infra.regions.get({
                  query: { providerId: flags.providerId as string | undefined },
                })
              );
              tableOrJson(flags, result, ["ID", "Name", "Slug", "Country", "City"], (r) => [
                styleMuted(String(r.regionId ?? "")),
                styleBold(String(r.name ?? "")),
                String(r.slug ?? ""),
                String(r.country ?? ""),
                String(r.city ?? ""),
              ]);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get region by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Region ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.regions({ id: args.id }).get()
              );
              detailView(flags, result, [
                ["ID", (r) => styleMuted(String(r.regionId ?? ""))],
                ["Name", (r) => styleBold(String(r.name ?? ""))],
                ["Slug", (r) => String(r.slug ?? "")],
                ["Country", (r) => String(r.country ?? "")],
                ["City", (r) => String(r.city ?? "")],
                ["Provider", (r) => String(r.providerId ?? "")],
              ]);
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
                api.api.v1.factory.infra.regions.post({
                  name: args.name,
                  displayName: (flags.displayName as string) ?? args.name,
                  slug: flags.slug as string | undefined,
                  country: flags.country as string | undefined,
                  city: flags.city as string | undefined,
                  providerId: flags.providerId as string | undefined,
                })
              );
              actionResult(flags, result, styleSuccess(`Region "${args.name}" created.`));
            })
        )
        .command("delete", (c) =>
          c
            .meta({ description: "Delete a region" })
            .args([{ name: "id", type: "string", required: true, description: "Region ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.regions({ id: args.id }).delete()
              );
              actionResult(flags, result, styleSuccess(`Region ${args.id} deleted.`));
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
                api.api.v1.factory.infra.clusters.get({
                  query: {
                    providerId: flags.providerId as string | undefined,
                    status: flags.status as string | undefined,
                  },
                })
              );
              tableOrJson(flags, result, ["ID", "Name", "Provider", "Status"], (r) => [
                styleMuted(String(r.clusterId ?? "")),
                styleBold(String(r.name ?? "")),
                String(r.providerId ?? ""),
                colorStatus(String(r.status ?? "")),
              ]);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get cluster by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Cluster ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.clusters({ id: args.id }).get()
              );
              detailView(flags, result, [
                ["ID", (r) => styleMuted(String(r.clusterId ?? ""))],
                ["Name", (r) => styleBold(String(r.name ?? ""))],
                ["Provider", (r) => String(r.providerId ?? "")],
                ["Status", (r) => colorStatus(String(r.status ?? ""))],
                ["Created", (r) => String(r.createdAt ?? "")],
              ]);
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
                api.api.v1.factory.infra.clusters.post({
                  name: args.name,
                  providerId: flags.providerId as string,
                })
              );
              actionResult(flags, result, styleSuccess(`Cluster "${args.name}" created.`));
            })
        )
        .command("destroy", (c) =>
          c
            .meta({ description: "Destroy a cluster" })
            .args([{ name: "id", type: "string", required: true, description: "Cluster ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.clusters({ id: args.id }).delete()
              );
              actionResult(flags, result, styleSuccess(`Cluster ${args.id} destroyed.`));
            })
        )
    )

    // --- VMs ---
    .command("vm", (c) =>
      c
        .meta({ description: "Manage virtual machines" })
        .command("list", (c) =>
          c
            .meta({ description: "List virtual machines" })
            .flags({
              all: { type: "boolean", alias: "a", description: "Include stopped VMs (default is running only)" },
              status: { type: "string", alias: "s", description: "Filter by status (running, stopped, provisioning, destroying)" },
              cluster: { type: "string", alias: "c", description: "Filter by cluster ID or slug" },
              host: { type: "string", description: "Filter by host ID or slug" },
              provider: { type: "string", alias: "p", description: "Filter by provider ID or slug" },
              limit: { type: "number", alias: "n", description: "Limit number of results (default: 50)" },
              sort: { type: "string", description: "Sort by: name, ip, cpu, ram, disk, status (default: name)" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const status = flags.all ? undefined : (flags.status as string | undefined) ?? "running";
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.vms.get({
                  query: {
                    providerId: flags.provider as string | undefined,
                    status,
                    hostId: flags.host as string | undefined,
                    clusterId: flags.cluster as string | undefined,
                  },
                })
              );

              const unwrapped = result && typeof result === "object" && "data" in result
                ? (result as Record<string, unknown>).data
                : result;
              let items = Array.isArray(unwrapped) ? unwrapped : [];

              const sortKey = (flags.sort as string) ?? "name";
              items.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
                switch (sortKey) {
                  case "ip":
                    return String(a.ipAddress ?? "").localeCompare(String(b.ipAddress ?? ""));
                  case "cpu":
                    return ((b.cpu as number) ?? 0) - ((a.cpu as number) ?? 0);
                  case "ram":
                    return ((b.memoryMb as number) ?? 0) - ((a.memoryMb as number) ?? 0);
                  case "disk":
                    return ((b.diskGb as number) ?? 0) - ((a.diskGb as number) ?? 0);
                  case "status":
                    return String(a.status ?? "").localeCompare(String(b.status ?? ""));
                  default:
                    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
                }
              });

              const limit = (flags.limit as number) ?? 50;
              if (items.length > limit) items = items.slice(0, limit);

              const f = toDxFlags(flags);
              if (f.json) {
                console.log(JSON.stringify({ success: true, data: items }, null, 2));
                return;
              }
              if (items.length === 0) {
                console.log("No VMs found.");
                return;
              }
              const vmColOpts: ColumnOpt[] = [
                {},                          // ID
                { style: styleBold },        // Name
                {},                          // IP
                { align: "right" },          // CPU
                { align: "right" },          // Memory
                { align: "right" },          // Disk
                {},                          // Status
              ];
              console.log(printTable(
                ["ID", "Name", "IP", "CPU", "RAM", "Disk", "Status"],
                items.map((r: Record<string, unknown>) => [
                  styleMuted(String(r.vmId ?? "")),
                  String(r.name ?? ""),
                  String(r.ipAddress ?? ""),
                  String(r.cpu ?? ""),
                  `${Math.round(((r.memoryMb as number) ?? 0) / 1024)}GB`,
                  `${r.diskGb ?? ""}GB`,
                  colorStatus(String(r.status ?? "")),
                ]),
                vmColOpts,
              ));
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get VM by ID" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.vms({ id: args.id }).get()
              );
              detailView(flags, result, [
                ["ID", (r) => styleMuted(String(r.vmId ?? ""))],
                ["Name", (r) => styleBold(String(r.name ?? ""))],
                ["IP", (r) => String(r.ipAddress ?? "")],
                ["CPU", (r) => String(r.cpu ?? "")],
                ["RAM", (r) => `${Math.round(((r.memoryMb as number) ?? 0) / 1024)}GB`],
                ["Disk", (r) => `${r.diskGb ?? ""}GB`],
                ["Host", (r) => String(r.hostId ?? "")],
                ["Cluster", (r) => String(r.clusterId ?? "")],
                ["Status", (r) => colorStatus(String(r.status ?? ""))],
                ["Created", (r) => String(r.createdAt ?? "")],
              ]);
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
                api.api.v1.factory.infra.vms.post({
                  name: args.name,
                  providerId: flags.providerId as string,
                  cpu: (flags.cpu as number) ?? 2,
                  memoryMb: (flags.memoryMb as number) ?? 4096,
                  diskGb: (flags.diskGb as number) ?? 50,
                  hostId: flags.hostId as string | undefined,
                  clusterId: flags.clusterId as string | undefined,
                })
              );
              actionResult(flags, result, styleSuccess(`VM "${args.name}" created.`));
            })
        )
        .command("start", (c) =>
          c
            .meta({ description: "Start a VM" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.vms({ id: args.id }).start.post()
              );
              actionResult(flags, result, styleSuccess(`VM ${args.id} started.`));
            })
        )
        .command("stop", (c) =>
          c
            .meta({ description: "Stop a VM" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.vms({ id: args.id }).stop.post()
              );
              actionResult(flags, result, styleSuccess(`VM ${args.id} stopped.`));
            })
        )
        .command("restart", (c) =>
          c
            .meta({ description: "Restart a VM" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.vms({ id: args.id }).restart.post()
              );
              actionResult(flags, result, styleSuccess(`VM ${args.id} restarted.`));
            })
        )
        .command("snapshot", (c) =>
          c
            .meta({ description: "Snapshot a VM" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.vms({ id: args.id }).snapshot.post()
              );
              actionResult(flags, result, styleSuccess(`VM ${args.id} snapshot created.`));
            })
        )
        .command("destroy", (c) =>
          c
            .meta({ description: "Destroy a VM" })
            .args([{ name: "id", type: "string", required: true, description: "VM ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.vms({ id: args.id }).delete()
              );
              actionResult(flags, result, styleSuccess(`VM ${args.id} destroyed.`));
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
                api.api.v1.factory.infra.hosts.get({
                  query: {
                    providerId: flags.providerId as string | undefined,
                    datacenterId: flags.datacenterId as string | undefined,
                    status: flags.status as string | undefined,
                  },
                })
              );
              tableOrJson(flags, result, ["ID", "Name", "CPU", "RAM", "Disk", "IP", "Status"], (r) => [
                styleMuted(String(r.hostId ?? "")),
                styleBold(String(r.name ?? "")),
                String(r.cpuCores ?? ""),
                `${Math.round(((r.memoryMb as number) ?? 0) / 1024)}GB`,
                `${r.diskGb ?? ""}GB`,
                String(r.ipAddress ?? ""),
                colorStatus(String(r.status ?? "")),
              ], [
                {},                    // ID
                {},                    // Name
                { align: "right" },    // CPU
                { align: "right" },    // Memory
                { align: "right" },    // Disk
                {},                    // IP
                {},                    // Status
              ]);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get host by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Host ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.hosts({ id: args.id }).get()
              );
              detailView(flags, result, [
                ["ID", (r) => styleMuted(String(r.hostId ?? ""))],
                ["Name", (r) => styleBold(String(r.name ?? ""))],
                ["CPU", (r) => String(r.cpuCores ?? "")],
                ["RAM", (r) => `${Math.round(((r.memoryMb as number) ?? 0) / 1024)}GB`],
                ["Disk", (r) => `${r.diskGb ?? ""}GB`],
                ["IP", (r) => String(r.ipAddress ?? "")],
                ["Provider", (r) => String(r.providerId ?? "")],
                ["Datacenter", (r) => String(r.datacenterId ?? "")],
                ["Status", (r) => colorStatus(String(r.status ?? ""))],
              ]);
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
                api.api.v1.factory.infra.hosts.post({
                  name: args.name,
                  providerId: flags.providerId as string,
                  cpuCores: flags.cpuCores as number,
                  memoryMb: flags.memoryMb as number,
                  diskGb: flags.diskGb as number,
                  datacenterId: flags.datacenterId as string | undefined,
                  ipAddress: flags.ipAddress as string | undefined,
                })
              );
              actionResult(flags, result, styleSuccess(`Host "${args.name}" added.`));
            })
        )
        .command("remove", (c) =>
          c
            .meta({ description: "Remove a host" })
            .args([{ name: "id", type: "string", required: true, description: "Host ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.hosts({ id: args.id }).delete()
              );
              actionResult(flags, result, styleSuccess(`Host ${args.id} removed.`));
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
                api.api.v1.factory.infra["kube-nodes"].get({
                  query: { clusterId: flags.clusterId as string },
                })
              );
              tableOrJson(flags, result, ["ID", "Name", "Role", "IP", "Cluster", "Status"], (r) => [
                styleMuted(String(r.kubeNodeId ?? "")),
                styleBold(String(r.name ?? "")),
                String(r.role ?? ""),
                String(r.ipAddress ?? ""),
                String(r.clusterId ?? ""),
                colorStatus(String(r.status ?? "")),
              ]);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get node by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Node ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra["kube-nodes"]({ id: args.id }).get()
              );
              detailView(flags, result, [
                ["ID", (r) => styleMuted(String(r.kubeNodeId ?? ""))],
                ["Name", (r) => styleBold(String(r.name ?? ""))],
                ["Role", (r) => String(r.role ?? "")],
                ["IP", (r) => String(r.ipAddress ?? "")],
                ["Cluster", (r) => String(r.clusterId ?? "")],
                ["VM", (r) => String(r.vmId ?? "")],
                ["Status", (r) => colorStatus(String(r.status ?? ""))],
              ]);
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
                api.api.v1.factory.infra["kube-nodes"].post({
                  name: args.name,
                  clusterId: flags.clusterId as string,
                  role: (flags.role as string) ?? "agent",
                  ipAddress: flags.ipAddress as string,
                  vmId: flags.vmId as string | undefined,
                })
              );
              actionResult(flags, result, styleSuccess(`Node "${args.name}" added.`));
            })
        )
        .command("remove", (c) =>
          c
            .meta({ description: "Remove a node" })
            .args([{ name: "id", type: "string", required: true, description: "Node ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra["kube-nodes"]({ id: args.id }).delete()
              );
              actionResult(flags, result, styleSuccess(`Node ${args.id} removed.`));
            })
        )
        .command("pause", (c) =>
          c
            .meta({ description: "Pause scheduling on a node" })
            .args([{ name: "id", type: "string", required: true, description: "Node ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra["kube-nodes"]({ id: args.id }).pause.post()
              );
              actionResult(flags, result, styleSuccess(`Node ${args.id} paused.`));
            })
        )
        .command("resume", (c) =>
          c
            .meta({ description: "Resume scheduling on a node" })
            .args([{ name: "id", type: "string", required: true, description: "Node ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra["kube-nodes"]({ id: args.id }).resume.post()
              );
              actionResult(flags, result, styleSuccess(`Node ${args.id} resumed.`));
            })
        )
        .command("evacuate", (c) =>
          c
            .meta({ description: "Evacuate all work off a node" })
            .args([{ name: "id", type: "string", required: true, description: "Node ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra["kube-nodes"]({ id: args.id }).evacuate.post()
              );
              actionResult(flags, result, styleSuccess(`Node ${args.id} evacuated.`));
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
                api.api.v1.factory.infra.subnets.get({
                  query: {
                    datacenterId: flags.datacenterId as string | undefined,
                    subnetType: flags.subnetType as string | undefined,
                  },
                })
              );
              tableOrJson(flags, result, ["ID", "CIDR", "Gateway", "Type", "VLAN"], (r) => [
                styleMuted(String(r.subnetId ?? "")),
                styleBold(String(r.cidr ?? "")),
                String(r.gateway ?? ""),
                String(r.subnetType ?? ""),
                String(r.vlanId ?? ""),
              ]);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get subnet by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Subnet ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.subnets({ id: args.id }).get()
              );
              detailView(flags, result, [
                ["ID", (r) => styleMuted(String(r.subnetId ?? ""))],
                ["CIDR", (r) => styleBold(String(r.cidr ?? ""))],
                ["Gateway", (r) => String(r.gateway ?? "")],
                ["Netmask", (r) => String(r.netmask ?? "")],
                ["Type", (r) => String(r.subnetType ?? "")],
                ["VLAN", (r) => String(r.vlanId ?? "")],
                ["Datacenter", (r) => String(r.datacenterId ?? "")],
                ["Description", (r) => String(r.description ?? "")],
              ]);
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
                api.api.v1.factory.infra.subnets.post({
                  cidr: args.cidr,
                  gateway: flags.gateway as string | undefined,
                  subnetType: (flags.subnetType as string) ?? "vm",
                  vlanId: flags.vlanId as number | undefined,
                  datacenterId: flags.datacenterId as string | undefined,
                  description: flags.description as string | undefined,
                })
              );
              actionResult(flags, result, styleSuccess(`Subnet ${args.cidr} created.`));
            })
        )
        .command("delete", (c) =>
          c
            .meta({ description: "Delete a subnet" })
            .args([{ name: "id", type: "string", required: true, description: "Subnet ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.subnets({ id: args.id }).delete()
              );
              actionResult(flags, result, styleSuccess(`Subnet ${args.id} deleted.`));
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
                api.api.v1.factory.infra.ips.get({
                  query: {
                    subnetId: flags.subnetId as string | undefined,
                    status: flags.status as string | undefined,
                    assignedToType: flags.assignedToType as string | undefined,
                  },
                })
              );
              tableOrJson(flags, result, ["ID", "Address", "Status", "Assigned To", "Hostname"], (r) => {
                let assigned = "";
                if (r.assignedToType && r.assignedToId) {
                  const label = r.assignedName ?? r.assignedToId;
                  assigned = `${r.assignedToType}:${label}`;
                }
                return [
                  styleMuted(String(r.ipAddressId ?? "")),
                  styleBold(String(r.address ?? "")),
                  colorStatus(String(r.status ?? "")),
                  assigned,
                  String(r.hostname ?? ""),
                ];
              });
            })
        )
        .command("available", (c) =>
          c
            .meta({ description: "List free/unassigned IPs" })
            .flags({
              subnetId: { type: "string", description: "Filter by subnet" },
              limit: { type: "number", alias: "n", description: "Limit results (default: 50)" },
              sort: { type: "string", description: "Sort by: address, subnet (default: address)" },
            })
            .run(async ({ flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.ips.available.get({
                  query: { subnetId: flags.subnetId as string | undefined },
                })
              );
              tableOrJson(flags, result, ["ID", "Address", "Subnet", "Hostname"], (r) => [
                styleMuted(String(r.ipAddressId ?? "")),
                styleBold(String(r.address ?? "")),
                String(r.subnetId ?? ""),
                String(r.hostname ?? ""),
              ], undefined, { emptyMessage: "No available IPs." });
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
                api.api.v1.factory.infra.ips.stats.get({
                  query: { subnetId: flags.subnetId as string | undefined },
                })
              );
              detailView(flags, result, [
                ["Total", (r) => styleBold(String(r.total ?? 0))],
                ["Available", (r) => styleSuccess(String(r.available ?? 0))],
                ["Assigned", (r) => String(r.assigned ?? 0)],
                ["Reserved", (r) => String(r.reserved ?? 0)],
              ]);
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
                api.api.v1.factory.infra.ips.register.post({
                  address: args.address,
                  subnetId: flags.subnetId as string | undefined,
                })
              );
              actionResult(flags, result, styleSuccess(`IP ${args.address} registered.`));
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
                api.api.v1.factory.infra.ips({ id: args.id }).assign.post({
                  assignedToType: flags.toType as string,
                  assignedToId: flags.toId as string,
                  hostname: flags.hostname as string | undefined,
                  purpose: flags.purpose as string | undefined,
                })
              );
              actionResult(flags, result, styleSuccess(`IP ${args.id} assigned to ${flags.toType}:${flags.toId}.`));
            })
        )
        .command("release", (c) =>
          c
            .meta({ description: "Release an IP back to available" })
            .args([{ name: "id", type: "string", required: true, description: "IP address ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.ips({ id: args.id }).release.post()
              );
              actionResult(flags, result, styleSuccess(`IP ${args.id} released.`));
            })
        )
        .command("lookup", (c) =>
          c
            .meta({ description: "Look up an IP by address" })
            .args([{ name: "address", type: "string", required: true, description: "IP address to find" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.ips.lookup.post({
                  address: args.address,
                })
              );
              detailView(flags, result, [
                ["ID", (r) => styleMuted(String(r.ipAddressId ?? ""))],
                ["Address", (r) => styleBold(String(r.address ?? ""))],
                ["Subnet", (r) => String(r.subnetId ?? "")],
                ["Status", (r) => colorStatus(String(r.status ?? ""))],
                ["Assigned To", (r) => {
                  if (r.assignedToType && r.assignedToId) {
                    return `${r.assignedToType}:${r.assignedName ?? r.assignedToId}`;
                  }
                  return "";
                }],
                ["Hostname", (r) => String(r.hostname ?? "")],
                ["Purpose", (r) => String(r.purpose ?? "")],
              ]);
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
                api.api.v1.factory.infra.assets.get()
              );
              tableOrJson(flags, result, ["ID", "Name", "Type", "Status"], (r) => [
                styleMuted(String(r.id ?? "")),
                styleBold(String(r.name ?? "")),
                String(r.type ?? ""),
                colorStatus(String(r.status ?? "")),
              ]);
            })
        )
        .command("get", (c) =>
          c
            .meta({ description: "Get asset by ID" })
            .args([{ name: "id", type: "string", required: true, description: "Asset ID" }])
            .run(async ({ args, flags }) => {
              const api = await getInfraApi();
              const result = await apiCall(flags, () =>
                api.api.v1.factory.infra.assets({ id: args.id }).get()
              );
              detailView(flags, result, [
                ["ID", (r) => styleMuted(String(r.id ?? ""))],
                ["Name", (r) => styleBold(String(r.name ?? ""))],
                ["Type", (r) => String(r.type ?? "")],
                ["Status", (r) => colorStatus(String(r.status ?? ""))],
              ]);
            })
        )
    );
}
