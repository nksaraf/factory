/**
 * Dev Console HTTP API server.
 *
 * Exposes `/api/dev/*` JSON endpoints and serves the embedded React SPA
 * for all other paths. In dev, Bun's fullstack mode provides HMR for
 * the React UI; in the compiled binary, the SPA + assets are embedded.
 */
/**
 * @deprecated Use agent-server.ts instead. This file is kept for
 * backward compatibility with code that directly imports
 * createDevConsoleServer. New code should use createAgentServer.
 */
import { Elysia, t } from "elysia"
import { existsSync, statSync, readFileSync } from "node:fs"
import { hostname, platform, arch, networkInterfaces, homedir } from "node:os"
import { join } from "node:path"

import { getFactoryRestClient } from "../client.js"
import type { SiteOrchestrator } from "../lib/site-orchestrator.js"
import { getStoredJwt } from "../session-token.js"

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1]
    if (!part) return null
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/")
    const json = Buffer.from(b64, "base64").toString("utf-8")
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

import indexHtml from "./ui/index.html"

export interface DevConsoleServerConfig {
  port: number
  hostname?: string
}

const SECRET_KEY_RE = /(KEY|SECRET|TOKEN|PASSWORD|PASS|DATABASE_URL)$/i

function maskSecrets(
  env: Record<string, { value: string; source: string; sourceDetail?: string }>
) {
  const out: Record<
    string,
    { value: string; source: string; sourceDetail?: string; masked: boolean }
  > = {}
  for (const [k, v] of Object.entries(env)) {
    const isSecret = SECRET_KEY_RE.test(k)
    out[k] = {
      value: isSecret ? "***" : v.value,
      source: v.source,
      sourceDetail: v.sourceDetail,
      masked: isSecret,
    }
  }
  return out
}

function getLocalIps(): string[] {
  const ips: string[] = []
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const addr of list ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address)
      }
    }
  }
  return ips
}

export function createDevConsoleServer(
  orchestrator: SiteOrchestrator,
  config: DevConsoleServerConfig
) {
  const activeStreams = new Set<() => void>()

  const api = new Elysia({ prefix: "/api/dev" })

    .get("/health", () => ({ data: { status: "ok" } }))

    .post(
      "/tunnel/start",
      async ({ body }) => {
        try {
          await orchestrator.startTunnel({
            exposeConsole: !!body?.exposeConsole,
          })
          return { data: orchestrator.getTunnelState() }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      { body: t.Optional(t.Object({ exposeConsole: t.Optional(t.Boolean()) })) }
    )

    .post("/tunnel/stop", () => {
      orchestrator.stopTunnel()
      return { data: orchestrator.getTunnelState() }
    })

    .get("/session", () => {
      const tunnel = orchestrator.getTunnelState()
      const state = orchestrator.site.getState()
      return {
        data: {
          project: orchestrator.project.name,
          sdSlug: orchestrator.sdSlug,
          site: state.spec.site,
          workbench: state.spec.workbench,
          tunnel,
          updatedAt: state.status.updatedAt,
        },
      }
    })

    .get("/services", async () => {
      const actual = await orchestrator.executor.inspect()
      const sd = orchestrator.site.getSystemDeployment(orchestrator.sdSlug)
      const byName = new Map(
        (sd?.componentDeployments ?? []).map((c) => [c.componentSlug, c])
      )
      const tunnel = orchestrator.getTunnelState().info
      const portUrls = new Map(
        (tunnel?.portUrls ?? []).map((p) => [p.port, p.url])
      )
      const catalog = orchestrator.project.catalog
      const allocations = orchestrator.getPortAllocations()
      const allocByService = new Map<string, { name: string; port: number }[]>()
      for (const a of allocations) {
        const [svc, portName] = a.name.split("/")
        if (!svc || !portName) continue
        if (!allocByService.has(svc)) allocByService.set(svc, [])
        allocByService.get(svc)!.push({ name: portName, port: a.port })
      }

      const services = actual.map((s) => {
        const cd = byName.get(s.name)
        const entry = catalog.components[s.name] ?? catalog.resources[s.name]
        const catalogPorts = entry?.spec?.ports ?? []

        const ports = s.ports.map((p, idx) => {
          const cp =
            catalogPorts[idx] ??
            catalogPorts.find((x) => x.port === p.container)
          return {
            name: cp?.name ?? String(p.container ?? p.host),
            host: p.host,
            container: p.container,
            protocol: cp?.protocol ?? "tcp",
            url: `http://localhost:${p.host}`,
            tunnelUrl: portUrls.get(p.host),
          }
        })

        if (ports.length === 0) {
          const allocs = allocByService.get(s.name) ?? []
          for (const alloc of allocs) {
            const cp = catalogPorts.find((x) => x.name === alloc.name)
            ports.push({
              name: alloc.name,
              host: alloc.port,
              container: cp?.port ?? alloc.port,
              protocol: cp?.protocol ?? "tcp",
              url: `http://localhost:${alloc.port}`,
              tunnelUrl: portUrls.get(alloc.port),
            })
          }
        }

        if (cd?.status.port && !ports.some((p) => p.host === cd.status.port)) {
          ports.unshift({
            name: "dev",
            host: cd.status.port,
            container: cd.status.port,
            protocol: "http",
            url: `http://localhost:${cd.status.port}`,
            tunnelUrl: portUrls.get(cd.status.port),
          })
        }

        const deps = orchestrator.graph.directDeps(s.name)

        return {
          name: s.name,
          mode: cd?.mode ?? "unknown",
          status: s.status,
          health: s.health,
          image: s.image,
          ports,
          pid: cd?.status.pid,
          phase: cd?.status.phase,
          conditions: cd?.status.conditions ?? [],
          kind: entry?.kind ?? null,
          type: entry?.spec?.type ?? null,
          description: entry?.metadata?.description ?? null,
          tags: entry?.metadata?.tags ?? [],
          owner: entry?.spec?.owner ?? null,
          deps,
        }
      })

      return { data: services }
    })

    .get(
      "/services/:name",
      async ({ params }) => {
        const sd = orchestrator.site.getSystemDeployment(orchestrator.sdSlug)
        const cd = sd?.componentDeployments.find(
          (c) => c.componentSlug === params.name
        )
        const catalog = orchestrator.project.catalog
        const entry =
          catalog.components[params.name] ?? catalog.resources[params.name]
        if (!entry) {
          return { error: `Component ${params.name} not found in catalog` }
        }

        let actualState
        try {
          actualState = await orchestrator.executor.inspectOne(params.name)
        } catch {
          actualState = null
        }

        const deps = orchestrator.graph.transitiveDeps(params.name)

        return {
          data: {
            name: params.name,
            catalog: entry,
            deployment: cd ?? null,
            actual: actualState,
            dependencies: deps,
          },
        }
      },
      { params: t.Object({ name: t.String() }) }
    )

    .get(
      "/services/:name/logs",
      async ({ params, query }) => {
        const tail = query.tail ? Number(query.tail) : 200
        try {
          const content = await orchestrator.executor.logs(params.name, {
            tail,
          })
          return { data: { lines: content.split("\n") } }
        } catch (err) {
          return {
            error: err instanceof Error ? err.message : String(err),
          }
        }
      },
      { params: t.Object({ name: t.String() }) }
    )

    .get(
      "/services/:name/logs/stream",
      ({ params, set }) => {
        const logPath = join(
          orchestrator.project.rootDir,
          ".dx",
          "dev",
          `${params.name}.log`
        )
        set.headers["content-type"] = "text/event-stream"
        set.headers["cache-control"] = "no-cache"
        set.headers["connection"] = "keep-alive"

        const encoder = new TextEncoder()
        let closed = false
        let close: () => void = () => {}

        const sd = orchestrator.site.getSystemDeployment(orchestrator.sdSlug)
        const cd = sd?.componentDeployments.find(
          (c) => c.componentSlug === params.name
        )
        const useFile = cd?.mode === "native" || existsSync(logPath)

        const stream = new ReadableStream({
          start(controller) {
            const send = (line: string) => {
              if (closed || !line) return
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(line)}\n\n`)
                )
              } catch {
                // closed
              }
            }

            if (useFile) {
              let offset = existsSync(logPath) ? statSync(logPath).size : 0
              let timer: ReturnType<typeof setTimeout> | null = null
              close = () => {
                if (closed) return
                closed = true
                if (timer) clearTimeout(timer)
                activeStreams.delete(close)
                try {
                  controller.close()
                } catch {
                  // already closed
                }
              }
              activeStreams.add(close)
              const tick = () => {
                if (closed) return
                try {
                  if (existsSync(logPath)) {
                    const size = statSync(logPath).size
                    if (size < offset) offset = 0
                    if (size > offset) {
                      const buf = readFileSync(logPath).subarray(offset, size)
                      offset = size
                      for (const line of buf.toString("utf8").split("\n")) {
                        send(line)
                      }
                    }
                  }
                } catch {
                  // ignore
                }
                if (!closed) timer = setTimeout(tick, 500)
              }
              tick()
            } else {
              const args = ["compose"]
              for (const f of orchestrator.project.composeFiles) {
                args.push("-f", f)
              }
              args.push(
                "-p",
                orchestrator.project.name,
                "logs",
                "-f",
                "--tail",
                "200",
                "--no-log-prefix",
                params.name
              )
              const proc = Bun.spawn(["docker", ...args], {
                cwd: orchestrator.project.rootDir,
                stdout: "pipe",
                stderr: "pipe",
              })
              close = () => {
                if (closed) return
                closed = true
                activeStreams.delete(close)
                try {
                  proc.kill()
                } catch {
                  // ignore
                }
                try {
                  controller.close()
                } catch {
                  // already closed
                }
              }
              activeStreams.add(close)

              const pump = async (
                stream: ReadableStream<Uint8Array> | null
              ) => {
                if (!stream) return
                const reader = stream.getReader()
                const dec = new TextDecoder()
                let buf = ""
                while (!closed) {
                  const { value, done } = await reader.read()
                  if (done) break
                  buf += dec.decode(value, { stream: true })
                  const parts = buf.split("\n")
                  buf = parts.pop() ?? ""
                  for (const line of parts) send(line)
                }
                if (buf) send(buf)
              }

              void pump(proc.stdout).catch(() => {})
              void pump(proc.stderr).catch(() => {})
              void proc.exited.then(() => close())
            }
          },
          cancel() {
            close()
          },
        })

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          },
        })
      },
      { params: t.Object({ name: t.String() }) }
    )

    .get("/catalog", () => {
      return { data: orchestrator.project.catalog }
    })

    .get("/env", () => {
      const sd = orchestrator.site.getSystemDeployment(orchestrator.sdSlug)
      const resolved = sd?.resolvedEnv ?? {}
      return { data: maskSecrets(resolved) }
    })

    .get("/ports", () => {
      return { data: orchestrator.getPortAllocations() }
    })

    .get("/graph", () => {
      const catalog = orchestrator.project.catalog
      const nodes: { id: string; type: "component" | "resource" }[] = []
      for (const name of Object.keys(catalog.components)) {
        nodes.push({ id: name, type: "component" })
      }
      for (const name of Object.keys(catalog.resources)) {
        nodes.push({ id: name, type: "resource" })
      }
      const edges: { from: string; to: string }[] = []
      for (const n of nodes) {
        for (const dep of orchestrator.graph.transitiveDeps(n.id)) {
          edges.push({ from: n.id, to: dep })
        }
      }
      return { data: { nodes, edges } }
    })

    .get("/threads/channels", async () => {
      try {
        const rest = await getFactoryRestClient()
        const collected: Array<{
          id: string
          kind: string
          name?: string | null
          externalId?: string | null
          repoSlug?: string | null
          createdAt?: string
          updatedAt?: string
        }> = []
        for (let offset = 0; offset < 2000; offset += 200) {
          const page = (await rest.request(
            "GET",
            `/api/v1/factory/threads/channels?limit=200&offset=${offset}`
          )) as { data: typeof collected }
          if (!page.data?.length) break
          collected.push(...page.data)
          if (page.data.length < 200) break
        }
        const all = { data: collected }
        const dir = orchestrator.ctx.workbench?.dir
        const wbName = orchestrator.ctx.workbench?.name
        const matches = (all.data ?? []).filter((c) => {
          if (dir && c.externalId === dir) return true
          if (wbName && c.kind === "conductor-workspace" && c.name === wbName)
            return true
          if (
            dir &&
            c.kind === "ide" &&
            c.externalId &&
            dir.startsWith(c.externalId)
          )
            return true
          return false
        })
        // Prefer conductor-workspace first (they're workbench-scoped),
        // then IDE channels. Within each kind, newest first.
        const kindRank = (k: string) =>
          k === "conductor-workspace" ? 0 : k === "ide" ? 1 : 2
        matches.sort((a, b) => {
          const kd = kindRank(String(a.kind)) - kindRank(String(b.kind))
          if (kd !== 0) return kd
          return String(b.updatedAt ?? "").localeCompare(
            String(a.updatedAt ?? "")
          )
        })
        return { data: matches }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })

    .get(
      "/threads/channels/:id/threads",
      async ({ params, query }) => {
        try {
          const rest = await getFactoryRestClient()
          const limit = query.limit ? Number(query.limit) : 50
          const res = (await rest.request(
            "GET",
            `/api/v1/factory/threads/channels/${encodeURIComponent(params.id)}/threads?limit=200`
          )) as { data: Array<Record<string, unknown>> }
          let list = res.data ?? []

          // Filter to threads whose cwd overlaps this workbench:
          // child of workbench dir, exact match, OR ancestor of it.
          const dir = orchestrator.ctx.workbench?.dir
          if (dir) {
            list = list.filter((t) => {
              const spec = (t.spec ?? {}) as Record<string, unknown>
              const cwd = typeof spec.cwd === "string" ? spec.cwd : ""
              return (
                !cwd ||
                cwd === dir ||
                cwd.startsWith(dir + "/") ||
                dir.startsWith(cwd + "/")
              )
            })
          }

          // Sort: latest activity first (updatedAt || startedAt).
          list.sort((a, b) => {
            const av = String(a.updatedAt ?? a.startedAt ?? "")
            const bv = String(b.updatedAt ?? b.startedAt ?? "")
            return bv.localeCompare(av)
          })

          list = list.slice(0, limit)

          // Enrich threads missing a human-readable title by fetching
          // the first user turn's prompt. Bounded to the top N visible.
          await Promise.all(
            list.map(async (thread) => {
              const spec = (thread.spec ?? {}) as Record<string, unknown>
              const existing =
                (typeof spec.generatedTopic === "string" &&
                  spec.generatedTopic) ||
                (typeof spec.title === "string" && spec.title) ||
                (typeof spec.firstPrompt === "string" && spec.firstPrompt)
              if (existing) {
                ;(thread as Record<string, unknown>).title = String(existing)
                return
              }
              try {
                const turns = (await rest.request(
                  "GET",
                  `/api/v1/factory/threads/threads/${encodeURIComponent(
                    thread.id as string
                  )}/turns?limit=3`
                )) as { data: Array<Record<string, unknown>> }
                const firstUser = (turns.data ?? []).find(
                  (t) => t.role === "user"
                )
                const prompt = firstUser
                  ? (firstUser.spec as Record<string, unknown>)?.prompt
                  : null
                if (typeof prompt === "string" && prompt.trim()) {
                  ;(thread as Record<string, unknown>).title = prompt.trim()
                }
              } catch {
                // leave title unset
              }
            })
          )

          return { data: list }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      { params: t.Object({ id: t.String() }) }
    )

    .get(
      "/threads/threads/:id",
      async ({ params }) => {
        try {
          const rest = await getFactoryRestClient()
          const res = (await rest.getEntity(
            "threads",
            "threads",
            params.id
          )) as { data: Record<string, unknown> | null }
          return { data: res.data }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      { params: t.Object({ id: t.String() }) }
    )

    .get(
      "/threads/threads/:id/turns",
      async ({ params, query }) => {
        try {
          const rest = await getFactoryRestClient()
          const limit = query.limit ? Number(query.limit) : 500
          const res = (await rest.request(
            "GET",
            `/api/v1/factory/threads/threads/${encodeURIComponent(params.id)}/turns?limit=${limit}`
          )) as { data: Array<Record<string, unknown>> }
          const sorted = [...(res.data ?? [])].sort(
            (a, b) =>
              ((a.turnIndex as number) ?? 0) - ((b.turnIndex as number) ?? 0)
          )
          return { data: sorted }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      { params: t.Object({ id: t.String() }) }
    )

    .get(
      "/threads/threads/:id/plans",
      async ({ params }) => {
        try {
          const rest = await getFactoryRestClient()
          const collected: Array<Record<string, unknown>> = []
          for (let offset = 0; offset < 2000; offset += 200) {
            const page = (await rest.request(
              "GET",
              `/api/v1/factory/plans?limit=200&offset=${offset}`
            )) as { plans?: Array<Record<string, unknown>> }
            const plans = page.plans ?? []
            if (!plans.length) break
            collected.push(...plans)
            if (plans.length < 200) break
          }
          const mine = collected.filter((p) => p.threadId === params.id)
          return { data: mine }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      { params: t.Object({ id: t.String() }) }
    )

    .get(
      "/plans/:slug/versions",
      async ({ params }) => {
        try {
          const rest = await getFactoryRestClient()
          const res = (await rest.request(
            "GET",
            `/api/v1/factory/documents/documents/${encodeURIComponent(params.slug)}/versions?limit=200`
          )) as
            | { versions?: Array<Record<string, unknown>> }
            | Array<Record<string, unknown>>
          const rows = Array.isArray(res) ? res : (res.versions ?? [])
          return {
            data: rows.map((r) => ({
              id: (r.id as string) ?? "",
              version: (r.version as number) ?? 0,
              title:
                ((r.spec as Record<string, unknown> | null)?.title as
                  | string
                  | undefined) ?? null,
              sourceTurnId: (r.sourceTurnId as string | null) ?? null,
              source: (r.source as string | null) ?? null,
              contentHash: (r.contentHash as string | null) ?? null,
              sizeBytes: (r.sizeBytes as number | null) ?? null,
              createdAt: (r.createdAt as string | null) ?? null,
            })),
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      { params: t.Object({ slug: t.String() }) }
    )

    .get(
      "/plans/:slug",
      async ({ params }) => {
        try {
          const rest = await getFactoryRestClient()
          const res = (await rest.request(
            "GET",
            `/api/v1/factory/documents/documents/${encodeURIComponent(params.slug)}/content`
          )) as { content?: string; path?: string; version?: number | null }
          return {
            data: {
              slug: params.slug,
              content: res.content ?? "",
              path: res.path ?? null,
              version: res.version ?? null,
            },
          }
        } catch (err) {
          const root = orchestrator.project.rootDir
          const home = homedir()
          const candidates = [
            join(home, ".claude", "plans", `${params.slug}.md`),
            join(root, ".context", "plans", `${params.slug}.md`),
            join(root, "docs", "superpowers", "plans", `${params.slug}.md`),
            join(root, "docs", "plans", `${params.slug}.md`),
          ]
          for (const p of candidates) {
            if (existsSync(p)) {
              return {
                data: {
                  slug: params.slug,
                  content: readFileSync(p, "utf8"),
                  path: p,
                  version: null,
                },
              }
            }
          }
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      { params: t.Object({ slug: t.String() }) }
    )

    .get("/whoami", async () => {
      const factoryUrl = orchestrator.ctx.host.factory.url
      const jwt = await getStoredJwt()
      const claims = jwt ? decodeJwtPayload(jwt) : null
      const user = claims
        ? {
            id: (claims.id as string) ?? (claims.sub as string) ?? null,
            name: (claims.name as string) ?? null,
            email: (claims.email as string) ?? null,
            role: (claims.role as string) ?? null,
            exp: (claims.exp as number) ?? null,
          }
        : null

      let factoryHealth: {
        status: "healthy" | "unreachable" | "unauthorized"
        latencyMs?: number
        error?: string
      } = { status: "unreachable" }
      const t0 = Date.now()
      try {
        const res = await fetch(`${factoryUrl}/health`, {
          headers: jwt ? { authorization: `Bearer ${jwt}` } : {},
          signal: AbortSignal.timeout(3000),
        })
        const latencyMs = Date.now() - t0
        if (res.ok) factoryHealth = { status: "healthy", latencyMs }
        else if (res.status === 401)
          factoryHealth = { status: "unauthorized", latencyMs }
        else
          factoryHealth = {
            status: "unreachable",
            latencyMs,
            error: `HTTP ${res.status}`,
          }
      } catch (err) {
        factoryHealth = {
          status: "unreachable",
          error: err instanceof Error ? err.message : String(err),
        }
      }

      return {
        data: {
          authenticated: !!user,
          user,
          factory: {
            url: factoryUrl,
            health: factoryHealth,
          },
        },
      }
    })

    .get("/location", () => {
      const ctx = orchestrator.ctx
      const state = orchestrator.site.getState()
      const composeProjectName =
        ctx.workbench?.composeProjectName ?? orchestrator.project.name

      return {
        data: {
          estate: null,
          host: {
            name: hostname(),
            os: platform(),
            arch: arch(),
            ips: getLocalIps(),
            factoryUrl: ctx.host.factory.url,
          },
          realm: {
            type: "compose-project" as const,
            name: composeProjectName,
          },
          site: state.spec.site,
          workbench: ctx.workbench
            ? {
                name: ctx.workbench.name,
                kind: ctx.workbench.kind,
                branch: ctx.workbench.branch,
                dir: ctx.workbench.dir,
                tunnelSubdomain: state.spec.workbench.tunnelSubdomain,
              }
            : {
                name: state.spec.workbench.slug,
                kind: state.spec.workbench.type,
                tunnelSubdomain: state.spec.workbench.tunnelSubdomain,
              },
          project: {
            name: orchestrator.project.name,
            rootDir: orchestrator.project.rootDir,
            composeFiles: orchestrator.project.composeFiles,
          },
          package: ctx.package
            ? {
                name: ctx.package.name,
                type: ctx.package.type,
                dir: ctx.package.dir,
              }
            : null,
        },
      }
    })

  let server: ReturnType<typeof Bun.serve> | null = null

  return {
    async start() {
      server = Bun.serve({
        port: config.port,
        hostname: config.hostname ?? "0.0.0.0",
        routes: {
          "/": indexHtml,
          "/services": indexHtml,
          "/services/:name": indexHtml,
          "/catalog": indexHtml,
          "/env": indexHtml,
          "/location": indexHtml,
          "/threads": indexHtml,
          "/threads/:threadId": indexHtml,
        },
        fetch: api.fetch,
        development:
          process.env.NODE_ENV !== "production" ? { hmr: true } : false,
      })
      const port = server.port ?? config.port
      return { port, url: `http://localhost:${port}` }
    },
    stop() {
      for (const close of activeStreams) close()
      activeStreams.clear()
      server?.stop(true)
      server = null
    },
  }
}
