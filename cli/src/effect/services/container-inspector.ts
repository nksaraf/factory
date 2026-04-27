import { Context, Effect, Layer, Ref } from "effect"
import { SshError } from "@smp/factory-shared/effect"
import type { AccessTarget } from "./remote-access.js"
import { RemoteExec } from "./remote-exec.js"

// ── Types ──────────────────────────────────────────────────

export interface ContainerEntry {
  readonly containerName: string
  readonly ip: string
  readonly composeProject: string
  readonly composeService: string
  readonly hostPorts: readonly number[]
  readonly exposedPorts: readonly number[]
  readonly cmd: readonly string[]
  readonly portMap: Readonly<Record<string, number>>
}

export interface ContainerMap {
  readonly entries: readonly ContainerEntry[]
  readonly byIp: ReadonlyMap<string, ContainerEntry>
  readonly byServiceName: ReadonlyMap<string, readonly ContainerEntry[]>
  readonly byHostPort: ReadonlyMap<number, ContainerEntry>
}

// ── Service ────────────────────────────────────────────────

export class ContainerInspector extends Context.Tag("ContainerInspector")<
  ContainerInspector,
  {
    readonly inspect: (
      target: AccessTarget
    ) => Effect.Effect<ContainerMap, SshError>
  }
>() {}

// ── Parser ─────────────────────────────────────────────────

const INSPECT_CMD = `docker ps -q | xargs -I{} docker inspect {} --format '{{.Name}}|{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{range $p, $bindings := .NetworkSettings.Ports}}{{range $bindings}}{{.HostPort}} {{end}}{{end}}|{{range $p, $v := .Config.ExposedPorts}}{{$p}} {{end}}|{{json .Config.Cmd}}'`

export function parseInspectOutput(stdout: string): ContainerEntry[] {
  const entries: ContainerEntry[] = []
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split("|")
    if (parts.length < 4) continue

    const containerName = parts[0].replace(/^\//, "")
    const ip = parts[1]
    const composeProject = parts[2]
    const composeService = parts[3]
    if (!ip || !composeProject || !composeService) continue

    const hostPorts = (parts[4] ?? "")
      .split(/\s+/)
      .map((p) => parseInt(p, 10))
      .filter((p) => Number.isFinite(p) && p > 0)

    const exposedPorts = (parts[5] ?? "")
      .split(/\s+/)
      .map((p) => parseInt(p, 10))
      .filter((p) => Number.isFinite(p) && p > 0)

    let cmd: string[] = []
    const cmdRaw = parts.slice(6).join("|").trim()
    if (cmdRaw && cmdRaw !== "null") {
      try {
        cmd = JSON.parse(cmdRaw) as string[]
      } catch {}
    }

    const portMap: Record<string, number> = {}
    // TODO: parse full port bindings for container→host mapping

    entries.push({
      containerName,
      ip,
      composeProject,
      composeService,
      hostPorts: [...new Set(hostPorts)],
      exposedPorts: [...new Set(exposedPorts)],
      cmd,
      portMap,
    })
  }
  return entries
}

export function buildContainerMap(entries: ContainerEntry[]): ContainerMap {
  const byIp = new Map<string, ContainerEntry>()
  const byServiceName = new Map<string, ContainerEntry[]>()
  const byHostPort = new Map<number, ContainerEntry>()

  for (const entry of entries) {
    byIp.set(entry.ip, entry)
    const existing = byServiceName.get(entry.composeService) ?? []
    existing.push(entry)
    byServiceName.set(entry.composeService, existing)
    for (const hp of entry.hostPorts) byHostPort.set(hp, entry)
  }

  return { entries, byIp, byServiceName, byHostPort }
}

// ── Layer ──────────────────────────────────────────────────

export const ContainerInspectorLive = Layer.effect(
  ContainerInspector,
  Effect.gen(function* () {
    const exec = yield* RemoteExec
    const cache = yield* Ref.make(new Map<string, ContainerMap>())

    return {
      inspect: (target: AccessTarget) =>
        Effect.gen(function* () {
          const key = target.slug
          const cached = yield* Ref.get(cache)
          const hit = cached.get(key)
          if (hit) return hit

          const result = yield* exec.run(target, INSPECT_CMD, {
            timeoutMs: 30_000,
          })
          const entries = parseInspectOutput(result.stdout)
          const map = buildContainerMap(entries)
          yield* Ref.update(cache, (m) => new Map(m).set(key, map))
          return map
        }),
    }
  })
)
