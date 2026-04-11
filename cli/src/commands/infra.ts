import { getFactoryClient, getFactoryRestClient } from "../client.js"
import type { DxBase } from "../dx-root.js"
import { printTable } from "../output.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"
import {
  type ColumnOpt,
  actionResult,
  apiCall,
  colorStatus,
  detailView,
  styleBold,
  styleMuted,
  styleSuccess,
  tableOrJson,
} from "./list-helpers.js"

/**
 * Shape of an infra entity row returned by the ontology API.
 * Used as the generic parameter for tableOrJson / detailView to avoid `any`.
 */
interface InfraRow {
  id?: string
  name?: string
  slug?: string
  type?: string
  status?: string
  createdAt?: string
  address?: string
  purpose?: string
  spec?: Record<string, unknown>
}

/** Shape returned by the IPAM stats endpoint. */
interface IpamStats {
  total?: number
  available?: number
  assigned?: number
  reserved?: number
}

/**
 * Wrap a FactoryClient (REST) call into the { data, error } shape that apiCall expects.
 * Used for endpoints Eden can't type: dynamic action paths and hyphenated entity CRUD.
 */
function restCall<T>(
  fn: () => Promise<T>
): Promise<{ data: T; error: unknown }> {
  return fn().then(
    (data) => ({ data, error: null }),
    (err) => ({ data: undefined as never, error: err })
  )
}

setExamples("infra", [
  "$ dx infra estate list              List estates (providers)",
  "$ dx infra realm list               List realms (clusters)",
  "$ dx infra host list                List hosts",
])

async function getInfraApi() {
  return getFactoryClient()
}

/** REST client for action endpoints and ip-addresses (Eden can't type these). */
async function getRestApi() {
  return getFactoryRestClient()
}

export function infraCommand(app: DxBase) {
  return (
    app
      .sub("infra")
      .meta({ description: "Infrastructure management" })

      // --- Estates (formerly Substrates/Providers) ---
      .command("estate", (c) =>
        c
          .meta({ description: "Manage infrastructure estates" })
          .command("list", (c) =>
            c
              .meta({ description: "List estates" })
              .flags({
                status: { type: "string", description: "Filter by status" },
              })
              .run(async ({ flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.estates.get({
                    query: { status: flags.status as string | undefined },
                  })
                )
                tableOrJson<InfraRow>(
                  flags,
                  result,
                  ["ID", "Name", "Type", "Kind", "Status"],
                  (r) => [
                    styleMuted(String(r.id ?? "")),
                    styleBold(String(r.name ?? "")),
                    String(r.spec?.type ?? ""),
                    String(r.spec?.kind ?? ""),
                    colorStatus(String(r.spec?.lifecycle ?? r.status ?? "")),
                  ]
                )
              })
          )
          .command("get", (c) =>
            c
              .meta({ description: "Get estate by ID" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Estate ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.estates({ slugOrId: args.id }).get()
                )
                detailView<InfraRow>(flags, result, [
                  ["ID", (r) => styleMuted(String(r.id ?? ""))],
                  ["Name", (r) => styleBold(String(r.name ?? ""))],
                  ["Type", (r) => String(r.spec?.type ?? "")],
                  ["Kind", (r) => String(r.spec?.kind ?? "")],
                  [
                    "Status",
                    (r) =>
                      colorStatus(String(r.spec?.lifecycle ?? r.status ?? "")),
                  ],
                  ["Created", (r) => String(r.createdAt ?? "")],
                ])
              })
          )
          .command("create", (c) =>
            c
              .meta({ description: "Create an estate" })
              .args([
                {
                  name: "name",
                  type: "string",
                  required: true,
                  description: "Estate name",
                },
              ])
              .flags({
                type: {
                  type: "string",
                  description: "Estate type (proxmox, hetzner, aws, gcp)",
                },
              })
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.estates.post({
                    name: args.name,
                    spec: { type: (flags.type as string) ?? "proxmox" },
                  })
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Estate "${args.name}" created.`)
                )
              })
          )
          .command("sync", (c) =>
            c
              .meta({ description: "Sync estate inventory" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Estate ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() => rest.infraAction("estates", args.id, "sync"))
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Estate ${args.id} sync started.`)
                )
              })
          )
      )

      // --- Regions (now estates with type=region) ---
      .command("region", (c) =>
        c
          .meta({ description: "Manage regions" })
          .command("list", (c) =>
            c
              .meta({ description: "List regions" })
              .flags({
                providerId: {
                  type: "string",
                  description: "Filter by provider ID",
                },
              })
              .run(async ({ flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.estates.get({
                    query: {
                      type: "region",
                      providerId: flags.providerId as string | undefined,
                    },
                  })
                )
                tableOrJson<InfraRow>(
                  flags,
                  result,
                  ["ID", "Name", "Slug", "Country", "City"],
                  (r) => [
                    styleMuted(String(r.id ?? "")),
                    styleBold(String(r.name ?? "")),
                    String(r.slug ?? ""),
                    String(r.spec?.country ?? ""),
                    String(r.spec?.city ?? ""),
                  ]
                )
              })
          )
          .command("get", (c) =>
            c
              .meta({ description: "Get region by ID" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Region ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.estates({ slugOrId: args.id }).get()
                )
                detailView<InfraRow>(flags, result, [
                  ["ID", (r) => styleMuted(String(r.id ?? ""))],
                  ["Name", (r) => styleBold(String(r.name ?? ""))],
                  ["Slug", (r) => String(r.slug ?? "")],
                  ["Country", (r) => String(r.spec?.country ?? "")],
                  ["City", (r) => String(r.spec?.city ?? "")],
                  ["Provider", (r) => String(r.spec?.parentId ?? "")],
                ])
              })
          )
          .command("create", (c) =>
            c
              .meta({ description: "Create a region" })
              .args([
                {
                  name: "name",
                  type: "string",
                  required: true,
                  description: "Region name",
                },
              ])
              .flags({
                displayName: { type: "string", description: "Display name" },
                slug: { type: "string", description: "URL slug" },
                country: { type: "string", description: "Country code" },
                city: { type: "string", description: "City" },
                providerId: { type: "string", description: "Provider ID" },
              })
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.estates.post({
                    name: args.name,
                    slug: flags.slug as string | undefined,
                    spec: {
                      type: "region",
                      country: flags.country as string | undefined,
                      city: flags.city as string | undefined,
                      parentId: flags.providerId as string | undefined,
                    },
                  })
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Region "${args.name}" created.`)
                )
              })
          )
          .command("delete", (c) =>
            c
              .meta({ description: "Delete a region" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Region ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra
                    .estates({ slugOrId: args.id })
                    .delete.post({})
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Region ${args.id} deleted.`)
                )
              })
          )
      )

      // --- Realms (formerly Runtimes/Clusters) ---
      .command("realm", (c) =>
        c
          .meta({ description: "Manage realms" })
          .command("list", (c) =>
            c
              .meta({ description: "List realms" })
              .flags({
                providerId: {
                  type: "string",
                  description: "Filter by provider",
                },
                status: { type: "string", description: "Filter by status" },
              })
              .run(async ({ flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.realms.get({
                    query: {
                      providerId: flags.providerId as string | undefined,
                      status: flags.status as string | undefined,
                    },
                  })
                )
                tableOrJson<InfraRow>(
                  flags,
                  result,
                  ["ID", "Name", "Estate", "Status"],
                  (r) => [
                    styleMuted(String(r.id ?? "")),
                    styleBold(String(r.name ?? "")),
                    String(r.spec?.estateId ?? ""),
                    colorStatus(String(r.spec?.lifecycle ?? r.status ?? "")),
                  ]
                )
              })
          )
          .command("get", (c) =>
            c
              .meta({ description: "Get realm by ID" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Realm ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.realms({ slugOrId: args.id }).get()
                )
                detailView<InfraRow>(flags, result, [
                  ["ID", (r) => styleMuted(String(r.id ?? ""))],
                  ["Name", (r) => styleBold(String(r.name ?? ""))],
                  ["Estate", (r) => String(r.spec?.estateId ?? "")],
                  [
                    "Status",
                    (r) =>
                      colorStatus(String(r.spec?.lifecycle ?? r.status ?? "")),
                  ],
                  ["Created", (r) => String(r.createdAt ?? "")],
                ])
              })
          )
          .command("create", (c) =>
            c
              .meta({ description: "Create a realm" })
              .args([
                {
                  name: "name",
                  type: "string",
                  required: true,
                  description: "Realm name",
                },
              ])
              .flags({
                providerId: {
                  type: "string",
                  required: true,
                  description: "Estate ID",
                },
              })
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.realms.post({
                    name: args.name,
                    spec: { estateId: flags.providerId as string },
                  })
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Realm "${args.name}" created.`)
                )
              })
          )
          .command("destroy", (c) =>
            c
              .meta({ description: "Destroy a realm" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Realm ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra
                    .realms({ slugOrId: args.id })
                    .delete.post({})
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Realm ${args.id} destroyed.`)
                )
              })
          )
      )

      // --- VMs (now hosts with type=vm) ---
      .command("vm", (c) =>
        c
          .meta({ description: "Manage virtual machines" })
          .command("list", (c) =>
            c
              .meta({ description: "List virtual machines" })
              .flags({
                all: {
                  type: "boolean",
                  alias: "a",
                  description: "Include stopped VMs (default is running only)",
                },
                status: {
                  type: "string",
                  alias: "s",
                  description:
                    "Filter by status (running, stopped, provisioning, destroying)",
                },
                cluster: {
                  type: "string",
                  alias: "c",
                  description: "Filter by cluster ID or slug",
                },
                host: {
                  type: "string",
                  description: "Filter by host ID or slug",
                },
                estate: {
                  type: "string",
                  alias: "p",
                  description: "Filter by estate ID or slug",
                },
                limit: {
                  type: "number",
                  alias: "n",
                  description: "Limit number of results (default: 50)",
                },
                sort: {
                  type: "string",
                  description:
                    "Sort by: name, ip, cpu, ram, disk, status (default: name)",
                },
              })
              .run(async ({ flags }) => {
                const api = await getInfraApi()
                const status = flags.all
                  ? undefined
                  : ((flags.status as string | undefined) ?? "running")
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.hosts.get({
                    query: {
                      type: "vm",
                      providerId: flags.estate as string | undefined,
                      status,
                      hostId: flags.host as string | undefined,
                      clusterId: flags.cluster as string | undefined,
                    },
                  })
                )

                const unwrapped =
                  result && typeof result === "object" && "data" in result
                    ? (result as { data: unknown }).data
                    : result
                let items = Array.isArray(unwrapped)
                  ? (unwrapped as InfraRow[])
                  : ([] as InfraRow[])

                const sortKey = (flags.sort as string) ?? "name"
                items.sort((a, b) => {
                  const aSpec = a.spec ?? {}
                  const bSpec = b.spec ?? {}
                  switch (sortKey) {
                    case "ip":
                      return String(aSpec.ipAddress ?? "").localeCompare(
                        String(bSpec.ipAddress ?? "")
                      )
                    case "cpu":
                      return (Number(bSpec.cpu) || 0) - (Number(aSpec.cpu) || 0)
                    case "ram":
                      return (
                        (Number(bSpec.memoryMb) || 0) -
                        (Number(aSpec.memoryMb) || 0)
                      )
                    case "disk":
                      return (
                        (Number(bSpec.diskGb) || 0) -
                        (Number(aSpec.diskGb) || 0)
                      )
                    case "status":
                      return String(
                        aSpec.lifecycle ?? a.status ?? ""
                      ).localeCompare(String(bSpec.lifecycle ?? b.status ?? ""))
                    default:
                      return String(a.name ?? "").localeCompare(
                        String(b.name ?? "")
                      )
                  }
                })

                const limit = (flags.limit as number) ?? 50
                if (items.length > limit) items = items.slice(0, limit)

                const f = toDxFlags(flags)
                if (f.json) {
                  console.log(
                    JSON.stringify({ success: true, data: items }, null, 2)
                  )
                  return
                }
                if (items.length === 0) {
                  console.log("No VMs found.")
                  return
                }
                const vmColOpts: ColumnOpt[] = [
                  {}, // ID
                  { style: styleBold }, // Name
                  {}, // IP
                  { align: "right" }, // CPU
                  { align: "right" }, // Memory
                  { align: "right" }, // Disk
                  {}, // Status
                ]
                console.log(
                  printTable(
                    ["ID", "Name", "IP", "CPU", "RAM", "Disk", "Status"],
                    items.map((r) => {
                      const spec = r.spec ?? {}
                      return [
                        styleMuted(String(r.id ?? "")),
                        String(r.name ?? ""),
                        String(spec.ipAddress ?? ""),
                        String(spec.cpu ?? ""),
                        `${Math.round((Number(spec.memoryMb) || 0) / 1024)}GB`,
                        `${spec.diskGb ?? ""}GB`,
                        colorStatus(String(spec.lifecycle ?? r.status ?? "")),
                      ]
                    }),
                    vmColOpts
                  )
                )
              })
          )
          .command("get", (c) =>
            c
              .meta({ description: "Get VM by ID" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "VM ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.hosts({ slugOrId: args.id }).get()
                )
                detailView<InfraRow>(flags, result, [
                  ["ID", (r) => styleMuted(String(r.id ?? ""))],
                  ["Name", (r) => styleBold(String(r.name ?? ""))],
                  ["IP", (r) => String(r.spec?.ipAddress ?? "")],
                  ["CPU", (r) => String(r.spec?.cpu ?? "")],
                  [
                    "RAM",
                    (r) =>
                      `${Math.round((Number(r.spec?.memoryMb) || 0) / 1024)}GB`,
                  ],
                  ["Disk", (r) => `${r.spec?.diskGb ?? ""}GB`],
                  ["Host", (r) => String(r.spec?.hostId ?? "")],
                  ["Realm", (r) => String(r.spec?.realmId ?? "")],
                  [
                    "Status",
                    (r) =>
                      colorStatus(String(r.spec?.lifecycle ?? r.status ?? "")),
                  ],
                  ["Created", (r) => String(r.createdAt ?? "")],
                ])
              })
          )
          .command("create", (c) =>
            c
              .meta({ description: "Create a VM" })
              .args([
                {
                  name: "name",
                  type: "string",
                  required: true,
                  description: "VM name",
                },
              ])
              .flags({
                providerId: {
                  type: "string",
                  required: true,
                  description: "Estate ID",
                },
                cpu: { type: "number", description: "CPU cores (default: 2)" },
                memoryMb: {
                  type: "number",
                  description: "Memory in MB (default: 4096)",
                },
                diskGb: {
                  type: "number",
                  description: "Disk in GB (default: 50)",
                },
                hostId: { type: "string", description: "Host ID" },
                clusterId: { type: "string", description: "Realm ID" },
              })
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.hosts.post({
                    name: args.name,
                    spec: {
                      type: "vm",
                      estateId: flags.providerId as string,
                      cpu: (flags.cpu as number) ?? 2,
                      memoryMb: (flags.memoryMb as number) ?? 4096,
                      diskGb: (flags.diskGb as number) ?? 50,
                      hostId: flags.hostId as string | undefined,
                      realmId: flags.clusterId as string | undefined,
                    },
                  })
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`VM "${args.name}" created.`)
                )
              })
          )
          .command("start", (c) =>
            c
              .meta({ description: "Start a VM" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "VM ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() => rest.infraAction("hosts", args.id, "start"))
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`VM ${args.id} started.`)
                )
              })
          )
          .command("stop", (c) =>
            c
              .meta({ description: "Stop a VM" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "VM ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() => rest.infraAction("hosts", args.id, "stop"))
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`VM ${args.id} stopped.`)
                )
              })
          )
          .command("restart", (c) =>
            c
              .meta({ description: "Restart a VM" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "VM ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() => rest.infraAction("hosts", args.id, "restart"))
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`VM ${args.id} restarted.`)
                )
              })
          )
          .command("snapshot", (c) =>
            c
              .meta({ description: "Snapshot a VM" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "VM ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() => rest.infraAction("hosts", args.id, "snapshot"))
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`VM ${args.id} snapshot created.`)
                )
              })
          )
          .command("destroy", (c) =>
            c
              .meta({ description: "Destroy a VM" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "VM ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra
                    .hosts({ slugOrId: args.id })
                    .delete.post({})
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`VM ${args.id} destroyed.`)
                )
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
                providerId: {
                  type: "string",
                  description: "Filter by provider",
                },
                datacenterId: {
                  type: "string",
                  description: "Filter by datacenter",
                },
                status: { type: "string", description: "Filter by status" },
              })
              .run(async ({ flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.hosts.get({
                    query: {
                      providerId: flags.providerId as string | undefined,
                      datacenterId: flags.datacenterId as string | undefined,
                      status: flags.status as string | undefined,
                    },
                  })
                )
                tableOrJson<InfraRow>(
                  flags,
                  result,
                  ["ID", "Name", "CPU", "RAM", "Disk", "IP", "Status"],
                  (r) => [
                    styleMuted(String(r.id ?? "")),
                    styleBold(String(r.name ?? "")),
                    String(r.spec?.cpuCores ?? ""),
                    `${Math.round((Number(r.spec?.memoryMb) || 0) / 1024)}GB`,
                    `${r.spec?.diskGb ?? ""}GB`,
                    String(r.spec?.ipAddress ?? ""),
                    colorStatus(String(r.spec?.lifecycle ?? r.status ?? "")),
                  ],
                  [
                    {}, // ID
                    {}, // Name
                    { align: "right" }, // CPU
                    { align: "right" }, // Memory
                    { align: "right" }, // Disk
                    {}, // IP
                    {}, // Status
                  ]
                )
              })
          )
          .command("get", (c) =>
            c
              .meta({ description: "Get host by ID" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Host ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.hosts({ slugOrId: args.id }).get()
                )
                detailView<InfraRow>(flags, result, [
                  ["ID", (r) => styleMuted(String(r.id ?? ""))],
                  ["Name", (r) => styleBold(String(r.name ?? ""))],
                  ["CPU", (r) => String(r.spec?.cpuCores ?? "")],
                  [
                    "RAM",
                    (r) =>
                      `${Math.round((Number(r.spec?.memoryMb) || 0) / 1024)}GB`,
                  ],
                  ["Disk", (r) => `${r.spec?.diskGb ?? ""}GB`],
                  ["IP", (r) => String(r.spec?.ipAddress ?? "")],
                  ["Estate", (r) => String(r.spec?.estateId ?? "")],
                  ["Datacenter", (r) => String(r.spec?.datacenterId ?? "")],
                  [
                    "Status",
                    (r) =>
                      colorStatus(String(r.spec?.lifecycle ?? r.status ?? "")),
                  ],
                ])
              })
          )
          .command("add", (c) =>
            c
              .meta({ description: "Add a host" })
              .args([
                {
                  name: "name",
                  type: "string",
                  required: true,
                  description: "Host name",
                },
              ])
              .flags({
                providerId: {
                  type: "string",
                  required: true,
                  description: "Estate ID",
                },
                cpuCores: {
                  type: "number",
                  required: true,
                  description: "CPU cores",
                },
                memoryMb: {
                  type: "number",
                  required: true,
                  description: "Memory in MB",
                },
                diskGb: {
                  type: "number",
                  required: true,
                  description: "Disk in GB",
                },
                datacenterId: { type: "string", description: "Datacenter ID" },
                ipAddress: { type: "string", description: "IP address" },
              })
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.hosts.post({
                    name: args.name,
                    spec: {
                      estateId: flags.providerId as string,
                      cpuCores: flags.cpuCores as number,
                      memoryMb: flags.memoryMb as number,
                      diskGb: flags.diskGb as number,
                      datacenterId: flags.datacenterId as string | undefined,
                      ipAddress: flags.ipAddress as string | undefined,
                    },
                  })
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Host "${args.name}" added.`)
                )
              })
          )
          .command("remove", (c) =>
            c
              .meta({ description: "Remove a host" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Host ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra
                    .hosts({ slugOrId: args.id })
                    .delete.post({})
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Host ${args.id} removed.`)
                )
              })
          )
      )

      // --- Kube Nodes (now hosts with type=kube-node) ---
      .command("kube-node", (c) =>
        c
          .meta({ description: "Manage Kube cluster nodes" })
          .command("list", (c) =>
            c
              .meta({ description: "List nodes in a cluster" })
              .flags({
                clusterId: {
                  type: "string",
                  required: true,
                  description: "Cluster ID",
                },
              })
              .run(async ({ flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.hosts.get({
                    query: {
                      type: "kube-node",
                      clusterId: flags.clusterId as string,
                    },
                  })
                )
                tableOrJson<InfraRow>(
                  flags,
                  result,
                  ["ID", "Name", "Role", "IP", "Realm", "Status"],
                  (r) => [
                    styleMuted(String(r.id ?? "")),
                    styleBold(String(r.name ?? "")),
                    String(r.spec?.role ?? ""),
                    String(r.spec?.ipAddress ?? ""),
                    String(r.spec?.realmId ?? ""),
                    colorStatus(String(r.spec?.lifecycle ?? r.status ?? "")),
                  ]
                )
              })
          )
          .command("get", (c) =>
            c
              .meta({ description: "Get node by ID" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Node ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.hosts({ slugOrId: args.id }).get()
                )
                detailView<InfraRow>(flags, result, [
                  ["ID", (r) => styleMuted(String(r.id ?? ""))],
                  ["Name", (r) => styleBold(String(r.name ?? ""))],
                  ["Role", (r) => String(r.spec?.role ?? "")],
                  ["IP", (r) => String(r.spec?.ipAddress ?? "")],
                  ["Realm", (r) => String(r.spec?.realmId ?? "")],
                  ["VM", (r) => String(r.spec?.vmId ?? "")],
                  [
                    "Status",
                    (r) =>
                      colorStatus(String(r.spec?.lifecycle ?? r.status ?? "")),
                  ],
                ])
              })
          )
          .command("add", (c) =>
            c
              .meta({ description: "Add a node to a cluster" })
              .args([
                {
                  name: "name",
                  type: "string",
                  required: true,
                  description: "Node name",
                },
              ])
              .flags({
                clusterId: {
                  type: "string",
                  required: true,
                  description: "Realm ID",
                },
                role: {
                  type: "string",
                  description: "Node role (server or agent, default: agent)",
                },
                ipAddress: {
                  type: "string",
                  required: true,
                  description: "Node IP address",
                },
                vmId: { type: "string", description: "VM ID for this node" },
              })
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.hosts.post({
                    name: args.name,
                    spec: {
                      type: "kube-node",
                      realmId: flags.clusterId as string,
                      role: (flags.role as string) ?? "agent",
                      ipAddress: flags.ipAddress as string,
                      vmId: flags.vmId as string | undefined,
                    },
                  })
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Node "${args.name}" added.`)
                )
              })
          )
          .command("remove", (c) =>
            c
              .meta({ description: "Remove a node" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Node ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra
                    .hosts({ slugOrId: args.id })
                    .delete.post({})
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Node ${args.id} removed.`)
                )
              })
          )
          .command("pause", (c) =>
            c
              .meta({ description: "Pause scheduling on a node" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Node ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() => rest.infraAction("hosts", args.id, "pause"))
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Node ${args.id} paused.`)
                )
              })
          )
          .command("resume", (c) =>
            c
              .meta({ description: "Resume scheduling on a node" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Node ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() => rest.infraAction("hosts", args.id, "resume"))
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Node ${args.id} resumed.`)
                )
              })
          )
          .command("evacuate", (c) =>
            c
              .meta({ description: "Evacuate all work off a node" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Node ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() => rest.infraAction("hosts", args.id, "evacuate"))
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Node ${args.id} evacuated.`)
                )
              })
          )
      )

      // --- Subnets (now estates with type=subnet) ---
      .command("subnet", (c) =>
        c
          .meta({ description: "Manage network subnets" })
          .command("list", (c) =>
            c
              .meta({ description: "List subnets" })
              .flags({
                datacenterId: {
                  type: "string",
                  description: "Filter by datacenter",
                },
                subnetType: { type: "string", description: "Filter by type" },
              })
              .run(async ({ flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.estates.get({
                    query: {
                      type: "subnet",
                      datacenterId: flags.datacenterId as string | undefined,
                      subnetType: flags.subnetType as string | undefined,
                    },
                  })
                )
                tableOrJson<InfraRow>(
                  flags,
                  result,
                  ["ID", "CIDR", "Gateway", "Type", "VLAN"],
                  (r) => [
                    styleMuted(String(r.id ?? "")),
                    styleBold(String(r.spec?.cidr ?? "")),
                    String(r.spec?.gateway ?? ""),
                    String(r.spec?.subnetType ?? ""),
                    String(r.spec?.vlanId ?? ""),
                  ]
                )
              })
          )
          .command("get", (c) =>
            c
              .meta({ description: "Get subnet by ID" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Subnet ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.estates({ slugOrId: args.id }).get()
                )
                detailView<InfraRow>(flags, result, [
                  ["ID", (r) => styleMuted(String(r.id ?? ""))],
                  ["CIDR", (r) => styleBold(String(r.spec?.cidr ?? ""))],
                  ["Gateway", (r) => String(r.spec?.gateway ?? "")],
                  ["Netmask", (r) => String(r.spec?.netmask ?? "")],
                  ["Type", (r) => String(r.spec?.subnetType ?? "")],
                  ["VLAN", (r) => String(r.spec?.vlanId ?? "")],
                  ["Datacenter", (r) => String(r.spec?.datacenterId ?? "")],
                  ["Description", (r) => String(r.spec?.description ?? "")],
                ])
              })
          )
          .command("create", (c) =>
            c
              .meta({ description: "Create a subnet" })
              .args([
                {
                  name: "cidr",
                  type: "string",
                  required: true,
                  description: "CIDR block (e.g. 10.0.1.0/24)",
                },
              ])
              .flags({
                gateway: { type: "string", description: "Gateway address" },
                subnetType: {
                  type: "string",
                  description:
                    "Subnet type (vm, management, storage, public, private)",
                },
                vlanId: { type: "number", description: "VLAN ID" },
                datacenterId: { type: "string", description: "Datacenter ID" },
                description: { type: "string", description: "Description" },
              })
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.estates.post({
                    name: args.cidr,
                    spec: {
                      type: "subnet",
                      cidr: args.cidr,
                      gateway: flags.gateway as string | undefined,
                      subnetType: (flags.subnetType as string) ?? "vm",
                      vlanId: flags.vlanId as number | undefined,
                      datacenterId: flags.datacenterId as string | undefined,
                      description: flags.description as string | undefined,
                    },
                  })
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Subnet ${args.cidr} created.`)
                )
              })
          )
          .command("delete", (c) =>
            c
              .meta({ description: "Delete a subnet" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Subnet ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra
                    .estates({ slugOrId: args.id })
                    .delete.post({})
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`Subnet ${args.id} deleted.`)
                )
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
                assignedToType: {
                  type: "string",
                  description: "Filter by assigned entity type",
                },
              })
              .run(async ({ flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() =>
                    rest.listIpAddresses({
                      subnetId: flags.subnetId as string | undefined,
                      status: flags.status as string | undefined,
                      assignedToType: flags.assignedToType as
                        | string
                        | undefined,
                    })
                  )
                )
                tableOrJson<InfraRow>(
                  flags,
                  result,
                  ["ID", "Address", "Status", "Assigned To", "Hostname"],
                  (r) => {
                    let assigned = ""
                    if (r.spec?.assignedToType && r.spec?.assignedToId) {
                      const label = r.spec?.assignedName ?? r.spec?.assignedToId
                      assigned = `${r.spec.assignedToType}:${label}`
                    }
                    return [
                      styleMuted(String(r.id ?? "")),
                      styleBold(String(r.spec?.address ?? r.address ?? "")),
                      colorStatus(String(r.spec?.status ?? r.status ?? "")),
                      assigned,
                      String(r.spec?.hostname ?? ""),
                    ]
                  }
                )
              })
          )
          .command("available", (c) =>
            c
              .meta({ description: "List free/unassigned IPs" })
              .flags({
                subnetId: { type: "string", description: "Filter by subnet" },
                limit: {
                  type: "number",
                  alias: "n",
                  description: "Limit results (default: 50)",
                },
                sort: {
                  type: "string",
                  description: "Sort by: address, subnet (default: address)",
                },
              })
              .run(async ({ flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() =>
                    rest.listAvailableIps({
                      subnetId: flags.subnetId as string | undefined,
                    })
                  )
                )
                tableOrJson<InfraRow>(
                  flags,
                  result,
                  ["ID", "Address", "Subnet", "Hostname"],
                  (r) => [
                    styleMuted(String(r.id ?? "")),
                    styleBold(String(r.spec?.address ?? r.address ?? "")),
                    String(r.spec?.subnetId ?? ""),
                    String(r.spec?.hostname ?? ""),
                  ],
                  undefined,
                  { emptyMessage: "No available IPs." }
                )
              })
          )
          .command("stats", (c) =>
            c
              .meta({ description: "IPAM statistics" })
              .flags({
                subnetId: { type: "string", description: "Filter by subnet" },
              })
              .run(async ({ flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra["ip-addresses"].stats.get({
                    query: { subnetId: flags.subnetId as string | undefined },
                  })
                )
                detailView<IpamStats>(flags, result, [
                  ["Total", (r) => styleBold(String(r.total ?? 0))],
                  ["Available", (r) => styleSuccess(String(r.available ?? 0))],
                  ["Assigned", (r) => String(r.assigned ?? 0)],
                  ["Reserved", (r) => String(r.reserved ?? 0)],
                ])
              })
          )
          .command("register", (c) =>
            c
              .meta({ description: "Register an IP address" })
              .args([
                {
                  name: "address",
                  type: "string",
                  required: true,
                  description: "IP address",
                },
              ])
              .flags({
                subnetId: { type: "string", description: "Subnet ID" },
              })
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() =>
                    rest.registerIpAddress({
                      address: args.address,
                      subnetId: flags.subnetId as string | undefined,
                    })
                  )
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`IP ${args.address} registered.`)
                )
              })
          )
          .command("assign", (c) =>
            c
              .meta({ description: "Assign an IP to an entity" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "IP address ID",
                },
              ])
              .flags({
                toType: {
                  type: "string",
                  required: true,
                  description:
                    "Entity type (vm, host, kube_node, cluster, service)",
                },
                toId: {
                  type: "string",
                  required: true,
                  description: "Entity ID",
                },
                hostname: { type: "string", description: "Hostname" },
                purpose: {
                  type: "string",
                  description: "Purpose (management, storage, application)",
                },
              })
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() =>
                    rest.ipAddressAction(args.id, "assign", {
                      assignedToType: flags.toType as string,
                      assignedToId: flags.toId as string,
                      hostname: flags.hostname as string | undefined,
                      purpose: flags.purpose as string | undefined,
                    })
                  )
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(
                    `IP ${args.id} assigned to ${flags.toType}:${flags.toId}.`
                  )
                )
              })
          )
          .command("release", (c) =>
            c
              .meta({ description: "Release an IP back to available" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "IP address ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() => rest.ipAddressAction(args.id, "release"))
                )
                actionResult(
                  flags,
                  result,
                  styleSuccess(`IP ${args.id} released.`)
                )
              })
          )
          .command("lookup", (c) =>
            c
              .meta({ description: "Look up an IP by address" })
              .args([
                {
                  name: "address",
                  type: "string",
                  required: true,
                  description: "IP address to find",
                },
              ])
              .run(async ({ args, flags }) => {
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra["ip-addresses"].lookup.post({
                    address: args.address,
                  })
                )
                detailView<InfraRow>(flags, result, [
                  ["ID", (r) => styleMuted(String(r.id ?? ""))],
                  [
                    "Address",
                    (r) =>
                      styleBold(String(r.spec?.address ?? r.address ?? "")),
                  ],
                  ["Subnet", (r) => String(r.spec?.subnetId ?? "")],
                  [
                    "Status",
                    (r) =>
                      colorStatus(String(r.spec?.status ?? r.status ?? "")),
                  ],
                  [
                    "Assigned To",
                    (r) => {
                      if (r.spec?.assignedToType && r.spec?.assignedToId) {
                        return `${r.spec.assignedToType}:${r.spec.assignedName ?? r.spec.assignedToId}`
                      }
                      return ""
                    },
                  ],
                  ["Hostname", (r) => String(r.spec?.hostname ?? "")],
                  ["Purpose", (r) => String(r.purpose ?? "")],
                ])
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
                const api = await getInfraApi()
                const result = await apiCall(flags, () =>
                  api.api.v1.factory.infra.assets.get()
                )
                tableOrJson<InfraRow>(
                  flags,
                  result,
                  ["ID", "Name", "Type", "Status"],
                  (r) => [
                    styleMuted(String(r.id ?? "")),
                    styleBold(String(r.name ?? "")),
                    String(r.type ?? ""),
                    colorStatus(String(r.status ?? "")),
                  ]
                )
              })
          )
          .command("get", (c) =>
            c
              .meta({ description: "Get asset by ID" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Asset ID",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getRestApi()
                const result = await apiCall(flags, () =>
                  restCall(() =>
                    rest.infraAction("assets", args.id, "get").then(() => {
                      throw new Error("Asset per-ID lookup not yet supported")
                    })
                  )
                )
                detailView<InfraRow>(flags, result, [
                  ["ID", (r) => styleMuted(String(r.id ?? ""))],
                  ["Name", (r) => styleBold(String(r.name ?? ""))],
                  ["Type", (r) => String(r.type ?? "")],
                  ["Status", (r) => colorStatus(String(r.status ?? ""))],
                ])
              })
          )
      )
  )
}
