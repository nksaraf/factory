import { Effect, Layer } from "effect"
import type { DxBase } from "../dx-root.js"
import {
  RemoteAccess,
  RemoteAccessLive,
  execLocal,
  runEffect,
} from "../effect/index.js"
import { resolveUrl } from "../lib/trace-resolver.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"
import {
  colorStatus,
  styleBold,
  styleError,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "./list-helpers.js"
import {
  formatProbeBadge,
  probeEdgeId,
  probeEndToEnd,
  probeTrace,
  runLocal,
  type TraceNodeLike,
} from "./route-probe.js"

setExamples("health", [
  "$ dx health https://trafficure.com              Quick health check",
  "$ dx health https://trafficure.com -v            With per-hop breakdown",
  "$ dx health lepton-59                            Check host reachability",
])

export function healthCommand(app: DxBase) {
  return app
    .sub("health")
    .meta({ description: "Health check a URL or service" })
    .args([
      {
        name: "target",
        type: "string",
        description: "URL or service slug to health-check",
      },
    ])
    .flags({
      verbose: {
        type: "boolean",
        alias: "v",
        description: "Show per-hop probe breakdown",
      },
    })
    .run(async ({ args, flags }) => {
      const target = args.target
      if (!target) {
        console.error(
          "Usage: dx health <url|service>\n  e.g. dx health https://trafficure.com/admin/airflow\n       dx health lepton-59"
        )
        process.exit(1)
      }

      try {
        if (target.includes("://")) {
          await healthCheckUrl(target, !!flags.verbose)
        } else {
          await healthCheckSlug(target)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Error: ${msg}`)
        process.exit(1)
      }
    })
}

async function healthCheckUrl(url: string, verbose: boolean) {
  console.log(`\n${styleBold("Health:")} ${url}\n`)

  // Run e2e probe + TLS check in parallel (+ optional trace probes)
  const resolved = verbose ? await resolveUrl(url).catch(() => null) : null

  const [e2e, tls, hopProbes] = await Promise.all([
    probeEndToEnd(url),
    url.startsWith("https://") ? checkTlsCert(url) : Promise.resolve(null),
    verbose && resolved?.traceRoot
      ? probeTrace(resolved.traceRoot)
      : Promise.resolve(null),
  ])

  // HTTP status
  const httpLabel = e2e.ok
    ? styleSuccess("✓ reachable")
    : styleError(`✗ ${e2e.error ?? "failed"}`)
  printRow("HTTP", httpLabel)

  // Timing breakdown
  if (e2e.dnsMs !== undefined) printRow("DNS", `${e2e.dnsMs}ms`)
  if (e2e.connectMs !== undefined) printRow("TCP", `${e2e.connectMs}ms`)
  if (e2e.tlsMs !== undefined) {
    let tlsLine = `${e2e.tlsMs}ms`
    if (tls) {
      if (tls.valid) {
        const daysStr =
          tls.daysRemaining <= 30
            ? styleWarn(`${tls.daysRemaining}d remaining`)
            : styleSuccess(`${tls.daysRemaining}d remaining`)
        tlsLine += `  (cert expires ${tls.notAfter}, ${daysStr})`
      } else {
        tlsLine += `  ${styleError(tls.error ?? "cert error")}`
      }
    }
    printRow("TLS", tlsLine)
  }
  if (e2e.ttfbMs !== undefined) printRow("TTFB", `${e2e.ttfbMs}ms`)
  if (e2e.totalMs !== undefined) printRow("Total", `${e2e.totalMs}ms`)

  // Verbose: per-hop breakdown
  if (verbose && hopProbes && resolved?.traceRoot) {
    console.log(`\n${styleBold("Per-hop probes:")}\n`)
    renderHopProbes(resolved.traceRoot, hopProbes)
  }

  console.log()
}

async function healthCheckSlug(slug: string) {
  console.log(`\n${styleBold("Health:")} ${slug}\n`)

  const program = Effect.gen(function* () {
    const access = yield* RemoteAccess
    const target = yield* access.resolve(slug)

    if (target.transport.kind !== "ssh") {
      printRow("Host", target.displayName)
      printRow("Transport", target.transport.kind)
      printRow("Status", colorStatus(target.status))
      return
    }

    const { host, port } = target.transport

    const result = yield* execLocal(
      `nc -zvw 3 ${host} ${port} 2>&1 && echo OK || echo FAIL`
    )
    const ok =
      result.code === 0 || /OK|succeeded/i.test(result.stdout + result.stderr)

    printRow("Host", `${target.displayName} (${host})`)
    printRow(
      "SSH",
      ok
        ? styleSuccess(`✓ port ${port} reachable`)
        : styleError(`✗ port ${port} unreachable`)
    )
    printRow("Status", colorStatus(target.status))
  })

  await runEffect(Effect.provide(program, RemoteAccessLive), "health-check")
  console.log()
}

function printRow(label: string, value: string) {
  console.log(`${styleMuted(label.padEnd(12))}${value}`)
}

// ─── TLS cert check ─────────────────────────────────────────

type TlsCertInfo = {
  valid: boolean
  notAfter: string
  daysRemaining: number
  error?: string
}

async function checkTlsCert(url: string): Promise<TlsCertInfo | null> {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname
    const port = parsed.port || "443"
    const cmd = `echo | openssl s_client -connect ${hostname}:${port} -servername ${hostname} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`
    const result = await runLocal(cmd)

    const match = result.stdout.match(/notAfter=(.+)/)
    if (!match) {
      return {
        valid: false,
        notAfter: "unknown",
        daysRemaining: 0,
        error: "could not parse cert",
      }
    }

    const notAfter = match[1].trim()
    const expiry = new Date(notAfter)
    const daysRemaining = Math.max(
      0,
      Math.round((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    )

    return {
      valid: daysRemaining > 0,
      notAfter: expiry.toISOString().split("T")[0],
      daysRemaining,
    }
  } catch {
    return null
  }
}

// ─── Verbose hop rendering ──────────────────────────────────

function renderHopProbes(
  root: TraceNodeLike,
  probes: Map<string, import("./route-probe.js").ProbeResult>
) {
  function walk(
    node: TraceNodeLike,
    parent: TraceNodeLike | undefined,
    indent: string
  ) {
    const slug = String(node.entity.slug ?? node.entity.id ?? "?")
    const type = String(node.entity.type ?? "?")

    if (parent) {
      const id = probeEdgeId(parent, node)
      const result = probes.get(id)
      const badge = formatProbeBadge(result, true)
      if (badge) {
        const status = result?.ok
          ? styleSuccess(badge.line)
          : result?.skipped
            ? styleMuted(badge.line)
            : styleError(badge.line)
        console.log(`${indent}│ ${status}`)
        if (badge.detail) {
          console.log(`${indent}│ ${styleMuted(badge.detail)}`)
        }
      }
    }

    console.log(`${indent}${styleBold(slug)} ${styleMuted(`[${type}]`)}`)

    for (const child of node.children) {
      walk(child, node, indent + "  ")
    }
  }

  walk(root, undefined, "  ")
}
