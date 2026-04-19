import { spawn } from "node:child_process"
import { EntityFinder, type ResolvedEntity } from "../lib/entity-finder.js"
import { buildSshArgs } from "../lib/ssh-utils.js"
import { HOST_TYPES } from "../lib/trace-resolver.js"

export type ProbeResult = {
  ok: boolean
  vantage: string
  totalMs?: number
  dnsMs?: number
  connectMs?: number
  tlsMs?: number
  ttfbMs?: number
  error?: string
  skipped?: string
}

export type TraceNodeLike = {
  entity: Record<string, unknown>
  link?: { id?: string; type: string; spec: Record<string, unknown> }
  weight?: number
  implicit?: boolean
  children: TraceNodeLike[]
}

type Edge = {
  edgeId: string
  parent: TraceNodeLike
  ancestors: TraceNodeLike[]
  child: TraceNodeLike
}

const PROBE_TIMEOUT_MS = 6000
const CONCURRENCY = 8

function edgeIdFor(parent: TraceNodeLike, child: TraceNodeLike): string {
  const p = String(parent.entity.id ?? parent.entity.slug ?? "?")
  const c = String(child.entity.id ?? child.entity.slug ?? "?")
  const lt = child.link?.type ?? (child.implicit ? "implicit" : "link")
  return `${p}→${c}[${lt}]`
}

/** Walk tree, yielding parent→child edges with ancestry context. */
function* walkEdges(
  root: TraceNodeLike,
  ancestors: TraceNodeLike[] = []
): Generator<Edge> {
  for (const child of root.children) {
    yield {
      edgeId: edgeIdFor(root, child),
      parent: root,
      ancestors,
      child,
    }
    yield* walkEdges(child, [...ancestors, root])
  }
}

/** Nearest ancestor (including self) that is a physical host with SSH. */
function findHostAncestor(
  self: TraceNodeLike,
  ancestors: TraceNodeLike[]
): TraceNodeLike | undefined {
  const chain = [...ancestors, self].reverse()
  for (const node of chain) {
    const t = String(node.entity.type ?? "")
    if (HOST_TYPES.has(t)) return node
  }
  return undefined
}

function entitySlug(node: TraceNodeLike): string {
  return String(node.entity.slug ?? node.entity.id ?? "?")
}

type VantageHost = {
  slug: string
  entity: ResolvedEntity
}

type VantageResult =
  | { kind: "host"; host: VantageHost }
  | { kind: "local" }
  | { kind: "none"; reason: string }

class VantageResolver {
  private finder = new EntityFinder()
  private cache = new Map<string, VantageResult>()

  async resolve(
    source: TraceNodeLike,
    ancestors: TraceNodeLike[]
  ): Promise<VantageResult> {
    const sourceType = String(source.entity.type ?? "")

    if (
      sourceType === "dns-domain" ||
      ["primary", "alias", "custom"].includes(sourceType)
    ) {
      return { kind: "local" }
    }
    if (sourceType === "ip-address") {
      // Fall through to host ancestor lookup (usually the public IP is anchored
      // to a host that owns the NAT), otherwise local.
    }

    const host =
      findHostAncestor(source, ancestors) ??
      (HOST_TYPES.has(sourceType) ? source : undefined)
    if (!host) {
      if (sourceType === "ip-address") return { kind: "local" }
      return { kind: "none", reason: "no host ancestor" }
    }

    const slug = entitySlug(host)
    const cached = this.cache.get(slug)
    if (cached) return cached

    try {
      const entity = await this.finder.resolve(slug)
      if (!entity || !entity.sshHost) {
        const res: VantageResult = {
          kind: "none",
          reason: "no SSH credentials",
        }
        this.cache.set(slug, res)
        return res
      }
      const res: VantageResult = { kind: "host", host: { slug, entity } }
      this.cache.set(slug, res)
      return res
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const res: VantageResult = {
        kind: "none",
        reason: `resolve failed: ${msg}`,
      }
      this.cache.set(slug, res)
      return res
    }
  }
}

// ─── Probe command builders ──────────────────────────────────

type ProbeCommand =
  | { kind: "curl"; url: string; hostHeader?: string }
  | { kind: "nc"; host: string; port: number }
  | { kind: "dns"; fqdn: string }
  | { kind: "skip"; reason: string }

function buildProbeForEdge(edge: Edge): ProbeCommand {
  const { child, parent } = edge
  const link = child.link
  const childSpec = (child.entity.spec ?? {}) as Record<string, unknown>
  const linkSpec = (link?.spec ?? {}) as Record<string, unknown>
  const port = linkSpec.egressPort as number | undefined
  const proto = (linkSpec.egressProtocol as string | undefined) ?? "tcp"

  // Implicit port-match: "can this port be reached on localhost of source?"
  if (child.implicit) {
    const p = port ?? (childSpec.port as number | undefined)
    if (!p) return { kind: "skip", reason: "no port" }
    return { kind: "nc", host: "127.0.0.1", port: p }
  }

  if (!link) return { kind: "skip", reason: "no link" }

  const linkType = link.type

  if (linkType === "dns-resolution") {
    const fqdn = String(child.entity.fqdn ?? child.entity.name ?? "")
    if (!fqdn) return { kind: "skip", reason: "no fqdn" }
    return { kind: "dns", fqdn }
  }

  // forward/proxy: prefer explicit address, else target host+port
  const address = linkSpec.address as string | undefined
  const targetType = String(child.entity.type ?? "")

  if (linkType === "forward" || linkType === "proxy") {
    if (address && address.includes("://")) {
      const hostHeader = (linkSpec.match as { hosts?: string[] } | undefined)
        ?.hosts?.[0]
      const probeUrl = address
        .replace("host.docker.internal", "127.0.0.1")
        .replace("gateway.docker.internal", "127.0.0.1")
      return { kind: "curl", url: probeUrl, hostHeader }
    }
    if (address) {
      // host:port form
      const hostHeader = (linkSpec.match as { hosts?: string[] } | undefined)
        ?.hosts?.[0]
      const url = `${proto === "https" ? "https" : "http"}://${address}`
      return { kind: "curl", url, hostHeader }
    }
    // Fall back to target entity's address
    const targetIp =
      (childSpec.ipAddress as string | undefined) ??
      (childSpec.hostname as string | undefined)
    if (targetIp && port) {
      const url = `${proto === "https" ? "https" : "http"}://${targetIp}:${port}`
      return { kind: "curl", url }
    }
    if (targetIp && !port) {
      return { kind: "nc", host: targetIp, port: 80 }
    }
    return { kind: "skip", reason: "no target address" }
  }

  if (linkType === "nat") {
    const parentEntity = parent.entity as Record<string, unknown>
    const publicIp =
      (linkSpec.publicIp as string | undefined) ??
      (parentEntity.address as string | undefined) ??
      (parentEntity.name as string | undefined) ??
      ((parentEntity.spec as Record<string, unknown> | undefined)?.ipAddress as
        | string
        | undefined)
    const natPort = port ?? 443
    if (publicIp) {
      return { kind: "curl", url: `http://${publicIp}:${natPort}` }
    }
    return { kind: "skip", reason: "n/a" }
  }

  // Terminal: component/service/container
  if (
    ["component", "component-deployment", "container", "service"].includes(
      targetType
    )
  ) {
    const ports = childSpec.ports as Array<{ port: number }> | undefined
    const p = port ?? ports?.[0]?.port
    const targetHost =
      (childSpec.ipAddress as string | undefined) ??
      (childSpec.hostname as string | undefined) ??
      "127.0.0.1"
    if (p) return { kind: "nc", host: targetHost, port: p }
  }

  return { kind: "skip", reason: `unhandled ${linkType}` }
}

// ─── Probe execution ────────────────────────────────────────

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

function renderRemoteCmd(probe: ProbeCommand): string {
  if (probe.kind === "curl") {
    const fmt =
      "dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} http=%{http_code}"
    const args = [
      "curl",
      "-sS",
      "-o",
      "/dev/null",
      "--max-time",
      "5",
      "-w",
      shellQuote(fmt),
    ]
    if (probe.hostHeader) {
      args.push("-H", shellQuote(`Host: ${probe.hostHeader}`))
    }
    args.push(shellQuote(probe.url))
    return args.join(" ")
  }
  if (probe.kind === "nc") {
    return `nc -zvw 2 ${shellQuote(probe.host)} ${probe.port} 2>&1 && echo OK || echo FAIL`
  }
  if (probe.kind === "dns") {
    return `getent hosts ${shellQuote(probe.fqdn)} >/dev/null 2>&1 && echo OK || echo FAIL`
  }
  return ""
}

function parseCurlOutput(stdout: string): Partial<ProbeResult> {
  const out: Partial<ProbeResult> = {}
  const get = (k: string) => {
    const m = stdout.match(new RegExp(`${k}=([0-9.]+)`))
    return m ? Math.round(parseFloat(m[1]) * 1000) : undefined
  }
  out.dnsMs = get("dns")
  out.connectMs = get("tcp")
  out.tlsMs = get("tls")
  out.ttfbMs = get("ttfb")
  out.totalMs = get("total")
  const http = stdout.match(/http=(\d+)/)
  const httpCode = http ? Number(http[1]) : 0
  out.ok = httpCode > 0 && httpCode < 500
  if (!out.ok)
    out.error = httpCode === 0 ? "connection failed" : `HTTP ${httpCode}`
  return out
}

function runRemote(
  vantage: VantageHost,
  remoteCmd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const sshArgs = buildSshArgs({
      host: vantage.entity.sshHost!,
      port: vantage.entity.sshPort,
      user: vantage.entity.sshUser,
      identity: vantage.entity.identityFile,
      jumpHost: vantage.entity.jumpHost,
      jumpUser: vantage.entity.jumpUser,
      jumpPort: vantage.entity.jumpPort,
      tty: "none",
      hostKeyCheck: "accept-new",
    })
    sshArgs.push("-o", "ConnectTimeout=5", "-o", "BatchMode=yes", remoteCmd)
    const proc = spawn("ssh", sshArgs, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      proc.kill("SIGKILL")
    }, PROBE_TIMEOUT_MS)
    proc.stdout.on("data", (d) => {
      stdout += d.toString()
    })
    proc.stderr.on("data", (d) => {
      stderr += d.toString()
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    proc.on("error", () => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: "spawn error" })
    })
  })
}

export function runLocal(
  remoteCmd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", remoteCmd], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => proc.kill("SIGKILL"), PROBE_TIMEOUT_MS)
    proc.stdout.on("data", (d) => {
      stdout += d.toString()
    })
    proc.stderr.on("data", (d) => {
      stderr += d.toString()
    })
    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
    proc.on("error", () => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: "spawn error" })
    })
  })
}

async function runProbe(
  vantage: VantageResult,
  probe: ProbeCommand
): Promise<ProbeResult> {
  if (probe.kind === "skip") {
    return { ok: false, vantage: "—", skipped: probe.reason }
  }
  if (vantage.kind === "none") {
    return { ok: false, vantage: "—", skipped: vantage.reason }
  }

  const cmd = renderRemoteCmd(probe)
  if (!cmd) return { ok: false, vantage: "—", skipped: "empty command" }

  const vantageName = vantage.kind === "local" ? "local" : vantage.host.slug
  const started = Date.now()
  const res =
    vantage.kind === "local"
      ? await runLocal(cmd)
      : await runRemote(vantage.host, cmd)
  const elapsed = Date.now() - started

  if (probe.kind === "curl") {
    const parsed = parseCurlOutput(res.stdout)
    return {
      vantage: vantageName,
      ok: parsed.ok ?? false,
      ...parsed,
    }
  }

  const okToken =
    /\bOK\b/.test(res.stdout) || /succeeded/i.test(res.stderr) || res.code === 0
  const failReason = res.stderr.match(
    /(Connection refused|No route to host|timed out|Name or service not known)/i
  )?.[0]
  return {
    vantage: vantageName,
    ok: okToken && res.code === 0,
    totalMs: elapsed,
    error: okToken && res.code === 0 ? undefined : (failReason ?? "failed"),
  }
}

// ─── Public entry point ─────────────────────────────────────

export async function probeTrace(
  root: TraceNodeLike
): Promise<Map<string, ProbeResult>> {
  const resolver = new VantageResolver()
  const edges = [...walkEdges(root)]

  const results = new Map<string, ProbeResult>()

  // Chunk execution for concurrency
  for (let i = 0; i < edges.length; i += CONCURRENCY) {
    const slice = edges.slice(i, i + CONCURRENCY)
    const settled = await Promise.all(
      slice.map(async (edge) => {
        const vantage = await resolver.resolve(edge.parent, edge.ancestors)
        const probe = buildProbeForEdge(edge)
        const result = await runProbe(vantage, probe)
        return [edge.edgeId, result] as const
      })
    )
    for (const [id, result] of settled) results.set(id, result)
  }

  return results
}

/** End-to-end cURL from the local machine to the full URL. */
export async function probeEndToEnd(url: string): Promise<ProbeResult> {
  const fmt =
    "dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} http=%{http_code}"
  const cmd = `curl -sS -o /dev/null --max-time 10 -w ${shellQuote(fmt)} ${shellQuote(url)}`
  const res = await runLocal(cmd)
  const parsed = parseCurlOutput(res.stdout)
  return { vantage: "local", ok: parsed.ok ?? false, ...parsed }
}

export function probeEdgeId(
  parent: TraceNodeLike,
  child: TraceNodeLike
): string {
  return edgeIdFor(parent, child)
}

export function formatProbeBadge(
  result: ProbeResult | undefined,
  verbose: boolean
): { line: string; detail?: string } | undefined {
  if (!result) return undefined
  if (result.skipped) {
    // Only surface genuine vantage-absence; hide "n/a" / "no port" etc. as noise.
    if (/SSH|credentials|vantage/i.test(result.skipped)) {
      return { line: `— ${result.skipped}` }
    }
    return undefined
  }
  const from = `(from ${result.vantage})`
  if (!result.ok) {
    const err = result.error ?? "failed"
    return { line: `✗ ${err}  ${from}` }
  }
  const parts: string[] = []
  if (result.connectMs !== undefined) parts.push(`tcp=${result.connectMs}ms`)
  if (result.ttfbMs !== undefined) parts.push(`ttfb=${result.ttfbMs}ms`)
  if (parts.length === 0 && result.totalMs !== undefined)
    parts.push(`${result.totalMs}ms`)
  const line = `✓ ${parts.join(" ")}  ${from}`
  const detail = verbose
    ? [
        result.dnsMs !== undefined ? `dns=${result.dnsMs}ms` : null,
        result.connectMs !== undefined ? `tcp=${result.connectMs}ms` : null,
        result.tlsMs !== undefined ? `tls=${result.tlsMs}ms` : null,
        result.ttfbMs !== undefined ? `ttfb=${result.ttfbMs}ms` : null,
        result.totalMs !== undefined ? `total=${result.totalMs}ms` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : undefined
  return { line, detail }
}
