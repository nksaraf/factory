// cli/src/site/agent-server.ts
/**
 * Unified site agent HTTP server.
 *
 * Merges the dev console API (/api/dev/*) and site controller API
 * (/api/v1/site/*) into a single Elysia app under /api/v1/site/.
 * Backward-compat aliases at /api/dev/ keep the React UI working
 * during migration.
 */
import { Elysia, t } from "elysia"
import { existsSync, readFileSync, statSync } from "node:fs"
import { hostname, platform, arch, networkInterfaces, homedir } from "node:os"
import { join } from "node:path"

import { getFactoryRestClient } from "../client.js"
import { getStoredJwt } from "../session-token.js"
import type { SiteAgent } from "./agent.js"

// ── Helpers ────────────────────────────────────────────────────────

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

export interface AgentServerConfig {
  port: number
  hostname?: string
}

export function createAgentServer(agent: SiteAgent, config: AgentServerConfig) {
  const activeStreams = new Set<() => void>()

  // ── Unified API under /api/v1/site/ ──────────────────────────────

  const app = new Elysia({ prefix: "/api/v1/site" })

    // ── Core routes (always available) ───────────────────────────

    .get("/health", () => ({
      data: { status: "ok", mode: agent.mode, pid: process.pid },
    }))

    .get("/status", () => ({ data: agent.getStatus() }))

    .get("/catalog", async () => {
      try {
        const catalog = await agent.executor.parseCatalog()
        return { data: catalog }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })

    // ── Service routes (unified from /api/dev/services + /api/v1/site/components) ──

    .get("/services", async () => {
      try {
        return { data: await agent.getServices() }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })

    .get(
      "/services/:name",
      async ({ params }) => {
        try {
          return { data: await agent.getServiceDetail(params.name) }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      { params: t.Object({ name: t.String() }) }
    )

    .get(
      "/services/:name/logs",
      async ({ params, query }) => {
        const tail = query.tail ? Number(query.tail) : 200
        try {
          const content = await agent.executor.logs(params.name, { tail })
          return { data: { lines: content.split("\n") } }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      { params: t.Object({ name: t.String() }) }
    )

    .get(
      "/services/:name/logs/stream",
      ({ params, set }) => {
        return agent.streamServiceLogs(params.name, set, activeStreams)
      },
      { params: t.Object({ name: t.String() }) }
    )

    .post(
      "/services/:name/deploy",
      async ({ params, set }) => {
        try {
          return { data: await agent.deployService(params.name) }
        } catch (err) {
          if (err instanceof Error && err.message.includes("not in manifest")) {
            set.status = 404
          }
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      { params: t.Object({ name: t.String() }) }
    )

    .post(
      "/services/:name/restart",
      async ({ params }) => {
        await agent.executor.restart(params.name)
        return { data: { restarted: params.name } }
      },
      { params: t.Object({ name: t.String() }) }
    )

    .post(
      "/services/:name/stop",
      async ({ params }) => {
        await agent.executor.stop(params.name)
        return { data: { stopped: params.name } }
      },
      { params: t.Object({ name: t.String() }) }
    )

    .post(
      "/services/:name/run",
      async ({ params, body }) => {
        const result = await agent.executor.run(params.name, body.cmd)
        return { data: result }
      },
      {
        params: t.Object({ name: t.String() }),
        body: t.Object({ cmd: t.Array(t.String()) }),
      }
    )

    .get(
      "/services/:name/health",
      async ({ params }) => {
        const health = await agent.executor.healthCheck(params.name)
        return { data: { component: params.name, health } }
      },
      { params: t.Object({ name: t.String() }) }
    )

    // ── Controller routes (reconcile, manifest, events) ──────────

    .post("/reconcile", async () => {
      if (!agent.controller) {
        return { error: "Reconcile not available (no controller in this mode)" }
      }
      const result = await agent.controller.reconcile()
      return { data: result }
    })

    .get("/manifest", () => {
      if (!agent.controller) {
        return { error: "No controller in this mode" }
      }
      const manifest = agent.controller.getManifest()
      if (!manifest) return { error: "No manifest loaded" }
      return { data: manifest }
    })

    .post("/manifest", async ({ body, set }) => {
      if (!agent.controller) {
        set.status = 400
        return { error: "No controller in this mode" }
      }
      const m = body as Record<string, unknown>
      if (
        typeof m.version !== "number" ||
        !m.systemDeployment ||
        !Array.isArray(m.componentDeployments)
      ) {
        set.status = 400
        return {
          error:
            "Invalid manifest: requires version (number), systemDeployment, and componentDeployments (array)",
        }
      }
      agent.controller.setManifest(m as any)
      const result = await agent.controller.reconcile()
      return { data: result }
    })

    .get("/events", () => {
      if (!agent.controller) {
        return { data: [] }
      }
      return { data: agent.controller.getEvents() }
    })

    .post(
      "/init/:name/run",
      async ({ params }) => {
        const result = await agent.executor.runInit(params.name)
        return { data: result }
      },
      { params: t.Object({ name: t.String() }) }
    )

    .get("/health-all", async () => {
      const health = await agent.executor.healthCheckAll()
      return { data: health }
    })

    // ── Dev-mode routes (session, tunnel, env, ports, graph, threads, plans) ──

    .get("/session", () => {
      if (!agent.orchestrator) {
        return { data: { mode: agent.mode, pid: process.pid } }
      }
      const tunnel = agent.orchestrator.getTunnelState()
      const state = agent.orchestrator.site.getState()
      return {
        data: {
          project: agent.orchestrator.project.name,
          sdSlug: agent.orchestrator.sdSlug,
          site: state.spec.site,
          workbench: state.spec.workbench,
          tunnel,
          updatedAt: state.status.updatedAt,
        },
      }
    })

    .post(
      "/tunnel/start",
      async ({ body }) => {
        if (!agent.orchestrator) {
          return { error: "Tunnel not available in this mode" }
        }
        try {
          await agent.orchestrator.startTunnel({
            exposeConsole: !!body?.exposeConsole,
          })
          return { data: agent.orchestrator.getTunnelState() }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      {
        body: t.Optional(t.Object({ exposeConsole: t.Optional(t.Boolean()) })),
      }
    )

    .post("/tunnel/stop", () => {
      if (!agent.orchestrator) {
        return { error: "Tunnel not available in this mode" }
      }
      agent.orchestrator.stopTunnel()
      return { data: agent.orchestrator.getTunnelState() }
    })

    .get("/env", () => {
      if (!agent.orchestrator) {
        return { data: {} }
      }
      const sd = agent.orchestrator.site.getSystemDeployment(
        agent.orchestrator.sdSlug
      )
      const resolved = sd?.resolvedEnv ?? {}
      return { data: maskSecrets(resolved) }
    })

    .get("/ports", () => {
      if (!agent.orchestrator) {
        return { data: [] }
      }
      return { data: agent.orchestrator.getPortAllocations() }
    })

    .get("/graph", () => {
      if (!agent.orchestrator) {
        return { data: { nodes: [], edges: [] } }
      }
      const catalog = agent.orchestrator.project.catalog
      const nodes: { id: string; type: "component" | "resource" }[] = []
      for (const name of Object.keys(catalog.components)) {
        nodes.push({ id: name, type: "component" })
      }
      for (const name of Object.keys(catalog.resources)) {
        nodes.push({ id: name, type: "resource" })
      }
      const edges: { from: string; to: string }[] = []
      for (const n of nodes) {
        for (const dep of agent.orchestrator.graph.transitiveDeps(n.id)) {
          edges.push({ from: n.id, to: dep })
        }
      }
      return { data: { nodes, edges } }
    })

    .get("/threads/channels", async () => {
      if (!agent.orchestrator) {
        return { data: [] }
      }
      try {
        const rest = await getFactoryRestClient()
        const collected: Array<{
          id: string
          kind: string
          name?: string | null
          externalId?: string | null
          repoSlug?: string | null
          createdAt?: string
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
        const dir = agent.orchestrator.ctx.workbench?.dir
        const wbName = agent.orchestrator.ctx.workbench?.name
        const matches = collected.filter((c) => {
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
        const kindRank = (k: string) =>
          k === "conductor-workspace" ? 0 : k === "ide" ? 1 : 2
        matches.sort((a, b) => {
          const kd = kindRank(String(a.kind)) - kindRank(String(b.kind))
          if (kd !== 0) return kd
          return String((b as any).updatedAt ?? "").localeCompare(
            String((a as any).updatedAt ?? "")
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
        if (!agent.orchestrator) {
          return { data: [] }
        }
        try {
          const rest = await getFactoryRestClient()
          const limit = query.limit ? Number(query.limit) : 50
          const res = (await rest.request(
            "GET",
            `/api/v1/factory/threads/channels/${encodeURIComponent(params.id)}/threads?limit=200`
          )) as { data: Array<Record<string, unknown>> }
          let list = res.data ?? []
          const dir = agent.orchestrator.ctx.workbench?.dir
          if (dir) {
            list = list.filter((th) => {
              const spec = (th.spec ?? {}) as Record<string, unknown>
              const cwd = typeof spec.cwd === "string" ? spec.cwd : ""
              return (
                !cwd ||
                cwd === dir ||
                cwd.startsWith(dir + "/") ||
                dir.startsWith(cwd + "/")
              )
            })
          }
          list.sort((a, b) => {
            const av = String(a.updatedAt ?? a.startedAt ?? "")
            const bv = String(b.updatedAt ?? b.startedAt ?? "")
            return bv.localeCompare(av)
          })
          list = list.slice(0, limit)
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
                  (tu) => tu.role === "user"
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
          )) as {
            content?: string
            path?: string
            version?: number | null
          }
          return {
            data: {
              slug: params.slug,
              content: res.content ?? "",
              path: res.path ?? null,
              version: res.version ?? null,
            },
          }
        } catch (err) {
          const rootDir = agent.orchestrator?.project.rootDir ?? process.cwd()
          const home = homedir()
          const candidates = [
            join(home, ".claude", "plans", `${params.slug}.md`),
            join(rootDir, ".context", "plans", `${params.slug}.md`),
            join(rootDir, "docs", "superpowers", "plans", `${params.slug}.md`),
            join(rootDir, "docs", "plans", `${params.slug}.md`),
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
      const factoryUrl =
        agent.orchestrator?.ctx.host.factory.url ?? agent.factoryUrl ?? ""
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
      if (factoryUrl) {
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
      }

      return {
        data: {
          authenticated: !!user,
          user,
          factory: { url: factoryUrl, health: factoryHealth },
        },
      }
    })

    .get("/location", () => {
      if (!agent.orchestrator) {
        return {
          data: {
            host: {
              name: hostname(),
              os: platform(),
              arch: arch(),
              ips: getLocalIps(),
            },
            mode: agent.mode,
          },
        }
      }
      const ctx = agent.orchestrator.ctx
      const state = agent.orchestrator.site.getState()
      const composeProjectName =
        ctx.workbench?.composeProjectName ?? agent.orchestrator.project.name
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
          realm: { type: "compose-project" as const, name: composeProjectName },
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
            name: agent.orchestrator.project.name,
            rootDir: agent.orchestrator.project.rootDir,
            composeFiles: agent.orchestrator.project.composeFiles,
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

    // ── Agent lifecycle routes ──────────────────────────────────────

    .get("/agent/logs", ({ set }) => {
      return agent.streamAgentLogs(set, activeStreams)
    })

    .post("/agent/stop", () => {
      // Schedule graceful shutdown after responding
      setTimeout(() => agent.shutdown(), 100)
      return { data: { stopping: true } }
    })

  // ── Backward compat: proxy /api/dev/* → /api/v1/site/* ───────────
  // The React SPA currently calls /api/dev/*. This proxy layer
  // rewrites requests so the existing UI works during migration.

  const devCompat = new Elysia({ prefix: "/api/dev" })
    .get("/health", () =>
      app
        .handle(new Request(`http://l/api/v1/site/health`))
        .then((r) => r.json())
    )
    .get("/session", () =>
      app
        .handle(new Request(`http://l/api/v1/site/session`))
        .then((r) => r.json())
    )
    .get("/services", () =>
      app
        .handle(new Request(`http://l/api/v1/site/services`))
        .then((r) => r.json())
    )
    .get("/services/:name", ({ params }) =>
      app
        .handle(new Request(`http://l/api/v1/site/services/${params.name}`))
        .then((r) => r.json())
    )
    .get("/services/:name/logs", ({ params, query }) => {
      const qs = query.tail ? `?tail=${query.tail}` : ""
      return app
        .handle(
          new Request(`http://l/api/v1/site/services/${params.name}/logs${qs}`)
        )
        .then((r) => r.json())
    })
    .get("/services/:name/logs/stream", ({ params }) =>
      app.handle(
        new Request(`http://l/api/v1/site/services/${params.name}/logs/stream`)
      )
    )
    .get("/catalog", () =>
      app
        .handle(new Request(`http://l/api/v1/site/catalog`))
        .then((r) => r.json())
    )
    .get("/env", () =>
      app.handle(new Request(`http://l/api/v1/site/env`)).then((r) => r.json())
    )
    .get("/ports", () =>
      app
        .handle(new Request(`http://l/api/v1/site/ports`))
        .then((r) => r.json())
    )
    .get("/graph", () =>
      app
        .handle(new Request(`http://l/api/v1/site/graph`))
        .then((r) => r.json())
    )
    .post("/tunnel/start", ({ body }) =>
      app
        .handle(
          new Request(`http://l/api/v1/site/tunnel/start`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        )
        .then((r) => r.json())
    )
    .post("/tunnel/stop", () =>
      app
        .handle(
          new Request(`http://l/api/v1/site/tunnel/stop`, { method: "POST" })
        )
        .then((r) => r.json())
    )
    .get("/whoami", () =>
      app
        .handle(new Request(`http://l/api/v1/site/whoami`))
        .then((r) => r.json())
    )
    .get("/location", () =>
      app
        .handle(new Request(`http://l/api/v1/site/location`))
        .then((r) => r.json())
    )
    .get("/threads/channels", () =>
      app
        .handle(new Request(`http://l/api/v1/site/threads/channels`))
        .then((r) => r.json())
    )
    .get("/threads/channels/:id/threads", ({ params }) =>
      app
        .handle(
          new Request(
            `http://l/api/v1/site/threads/channels/${params.id}/threads`
          )
        )
        .then((r) => r.json())
    )
    .get("/threads/threads/:id", ({ params }) =>
      app
        .handle(
          new Request(`http://l/api/v1/site/threads/threads/${params.id}`)
        )
        .then((r) => r.json())
    )
    .get("/threads/threads/:id/turns", ({ params }) =>
      app
        .handle(
          new Request(`http://l/api/v1/site/threads/threads/${params.id}/turns`)
        )
        .then((r) => r.json())
    )
    .get("/threads/threads/:id/plans", ({ params }) =>
      app
        .handle(
          new Request(`http://l/api/v1/site/threads/threads/${params.id}/plans`)
        )
        .then((r) => r.json())
    )
    .get("/plans/:slug", ({ params }) =>
      app
        .handle(new Request(`http://l/api/v1/site/plans/${params.slug}`))
        .then((r) => r.json())
    )
    .get("/plans/:slug/versions", ({ params }) =>
      app
        .handle(
          new Request(`http://l/api/v1/site/plans/${params.slug}/versions`)
        )
        .then((r) => r.json())
    )

  let server: ReturnType<typeof Bun.serve> | null = null

  return {
    app,
    async start() {
      let indexHtml: any
      try {
        indexHtml = (await import("../dev-console/ui/index.html")).default
      } catch {
        indexHtml = undefined
      }

      // Compose both Elysia apps
      const combinedApp = new Elysia().use(app).use(devCompat)

      server = Bun.serve({
        port: config.port,
        hostname: config.hostname ?? "0.0.0.0",
        routes: indexHtml
          ? {
              "/": indexHtml,
              "/services": indexHtml,
              "/services/:name": indexHtml,
              "/catalog": indexHtml,
              "/env": indexHtml,
              "/location": indexHtml,
              "/threads": indexHtml,
              "/threads/:threadId": indexHtml,
            }
          : undefined,
        fetch: combinedApp.fetch,
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
