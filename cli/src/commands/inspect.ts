import { getFactoryRestClient } from "../client.js"
import type { DxBase } from "../dx-root.js"
import { EntityFinder } from "../lib/entity-finder.js"
import { resolveUrl } from "../lib/trace-resolver.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"
import {
  colorStatus,
  detailView,
  styleBold,
  styleMuted,
} from "./list-helpers.js"

setExamples("inspect", [
  "$ dx inspect https://trafficure.com/admin/airflow   Inspect via URL",
  "$ dx inspect airflow-webserver                      Inspect by slug",
])

export function inspectCommand(app: DxBase) {
  return app
    .sub("inspect")
    .meta({ description: "Show detailed component information" })
    .args([
      {
        name: "target",
        type: "string",
        description: "Service slug or URL to inspect",
      },
    ])
    .flags({
      site: { type: "string", description: "Target site for disambiguation" },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)
      const target = args.target
      if (!target) {
        console.error(
          "Usage: dx inspect <service|url>\n  e.g. dx inspect https://trafficure.com/admin/airflow\n       dx inspect airflow-webserver"
        )
        process.exit(1)
      }

      try {
        if (target.includes("://")) {
          await inspectFromUrl(target, flags)
        } else {
          await inspectFromSlug(target, flags)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error: ${msg}`)
        process.exit(1)
      }
    })
}

async function inspectFromUrl(url: string, flags: Record<string, unknown>) {
  console.log(styleMuted(`Resolving ${url}…\n`))
  const resolved = await resolveUrl(url)
  const spec = resolved.spec

  type InspectData = typeof resolved
  detailView<InspectData>(flags, resolved, [
    ["Name", (r) => styleBold(r.entitySlug)],
    ["Type", (r) => r.entityType],
    [
      "Host",
      (r) =>
        r.hostSlug
          ? `${r.hostSlug}${r.hostEntity?.sshHost ? ` (${r.hostEntity.sshHost})` : ""}`
          : "—",
    ],
    ["Service", (r) => r.serviceName ?? "—"],
    [
      "Port",
      (r) => {
        if (r.targetPort) return `:${r.targetPort}`
        const ports = r.spec.ports as Array<{ port: number }> | undefined
        return ports?.length ? ports.map((p) => `:${p.port}`).join(", ") : "—"
      },
    ],
    ["Image", (r) => (r.spec.image as string) ?? "—"],
    [
      "URL",
      (r) => (r.domain && r.path ? `${r.domain}${r.path}` : (r.domain ?? "—")),
    ],
    [
      "Compose",
      (r) => {
        if (r.composeProject && r.serviceName)
          return `${r.composeProject} / ${r.serviceName}`
        return r.composeProject ?? r.serviceName ?? "—"
      },
    ],
  ])
}

async function inspectFromSlug(slug: string, flags: Record<string, unknown>) {
  // Try EntityFinder first (hosts, workbenches)
  const finder = new EntityFinder()
  const entity = await finder.resolve(slug)

  if (entity) {
    type E = NonNullable<typeof entity>
    detailView<E>(flags, entity, [
      ["Name", (e) => styleBold(e.displayName)],
      ["Type", (e) => e.type],
      ["Status", (e) => colorStatus(e.status)],
      ["Transport", (e) => e.transport],
      [
        "Host",
        (e) =>
          e.sshHost
            ? `${e.sshHost}${e.sshPort && e.sshPort !== 22 ? `:${e.sshPort}` : ""}`
            : "—",
      ],
      ["User", (e) => e.sshUser ?? "—"],
      [
        "Jump",
        (e) =>
          e.jumpHost
            ? `${e.jumpUser ? `${e.jumpUser}@` : ""}${e.jumpHost}${e.jumpPort ? `:${e.jumpPort}` : ""}`
            : "—",
      ],
    ])
    return
  }

  // Try the infra API for components/services
  const rest = await getFactoryRestClient()
  try {
    const result = await rest.request<{
      data: Record<string, unknown>
    }>("GET", `/api/v1/factory/infra/entities/${encodeURIComponent(slug)}`)
    const data = result.data
    const spec = (data.spec ?? {}) as Record<string, unknown>

    type D = typeof data
    detailView<D>(flags, data, [
      ["Name", (d) => styleBold(String(d.name ?? d.slug ?? slug))],
      ["Type", (d) => String(d.type ?? "unknown")],
      [
        "Status",
        (d) => {
          const status = (d.status as Record<string, unknown> | undefined)
            ?.phase as string | undefined
          return status ? colorStatus(status) : "—"
        },
      ],
      [
        "Ports",
        () => {
          const ports = spec.ports as Array<{ port: number }> | undefined
          return ports?.length ? ports.map((p) => `:${p.port}`).join(", ") : "—"
        },
      ],
      ["Image", () => (spec.image as string) ?? "—"],
      [
        "Compose",
        () => {
          const project = spec.composeProject as string | undefined
          const svc = spec.composeService as string | undefined
          if (project && svc) return `${project} / ${svc}`
          return project ?? svc ?? "—"
        },
      ],
    ])
  } catch {
    console.error(`No entity found for: ${slug}`)
    process.exit(1)
  }
}
