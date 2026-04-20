# Unified Site Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the dev console and site controller into a single "site agent" daemon process — one process per site that serves a unified API, survives terminal disconnection, and supports CLI attach/detach.

**Architecture:** The site agent wraps both `SiteOrchestrator` (dev/up modes) and `SiteController` (controller mode) behind a single HTTP server with one API namespace (`/api/v1/site/`). The daemon is spawned by `dx dev`/`dx up`/`dx site start` as a detached background process. CLI commands attach to the running daemon's log stream; Ctrl+C detaches without killing the agent. The React SPA is served by the unified server in all modes.

**Tech Stack:** TypeScript, Elysia (HTTP), Bun (runtime + process management), React (existing SPA)

**Scope:** Core unification only (items 1-3 from the capability assessment). Kubernetes executor, remote state backend, and observer mode are deferred to a follow-up plan.

---

### Task 1: Create the unified agent server

Merge route handlers from `controller-server.ts` and `dev-console/server.ts` into a single Elysia app. All routes live under `/api/v1/site/`. The server also mounts backward-compat aliases at `/api/dev/` so the existing React UI works without changes during migration.

**Files:**

- Create: `cli/src/site/agent-server.ts`
- Read: `cli/src/site/controller-server.ts` (route reference)
- Read: `cli/src/dev-console/server.ts` (route reference)

- [ ] **Step 1: Create the agent server file with core + service routes**

Create `cli/src/site/agent-server.ts`. The server takes a `SiteAgentContext` interface — a unified view of the agent's capabilities that both orchestrator-backed and controller-backed modes can satisfy.

```typescript
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

  // ── Backward compat: mount same routes at /api/dev/ ──────────────
  // The React SPA currently calls /api/dev/*. Mount aliases so the
  // existing UI works without changes during migration.

  const devCompat = new Elysia({ prefix: "/api/dev" })
    .get("/health", () => ({
      data: { status: "ok", mode: agent.mode },
    }))
    .get("/session", () =>
      app
        .handle(new Request("http://localhost/api/v1/site/session"))
        .then((r: Response) => r.json())
    )

  // NOTE: For full backward compat, the dev-compat layer uses a
  // proxy approach — see Step 3 for the actual implementation.

  let server: ReturnType<typeof Bun.serve> | null = null

  return {
    app,
    async start() {
      // Dynamic import to handle both compiled and dev modes
      let indexHtml: any
      try {
        indexHtml = (await import("../dev-console/ui/index.html")).default
      } catch {
        indexHtml = undefined
      }

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
          : {},
        fetch: app.fetch,
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
```

- [ ] **Step 2: Run type check to verify the file compiles**

```bash
cd cli && npx tsgo --noEmit src/site/agent-server.ts 2>&1 | head -30
```

Expected: Type errors referencing `SiteAgent` (not yet created). That's correct — Task 2 creates the SiteAgent class.

- [ ] **Step 3: Commit**

```bash
git add cli/src/site/agent-server.ts
git commit -m "feat(site): add unified agent server with merged API surface"
```

---

### Task 2: Create the SiteAgent class

The `SiteAgent` is the unified process owner. It holds references to both the `SiteOrchestrator` (for dev/up modes) and the `SiteController` (for controller mode), delegates to whichever is active, and provides a uniform interface for the agent server.

**Files:**

- Create: `cli/src/site/agent.ts`
- Read: `cli/src/lib/site-orchestrator.ts` (interface reference)
- Read: `cli/src/site/controller.ts` (interface reference)
- Read: `cli/src/site/execution/executor.ts` (Executor interface)

- [ ] **Step 1: Create the SiteAgent class**

```typescript
// cli/src/site/agent.ts
/**
 * Site agent — the unified daemon process for a site.
 *
 * Wraps both SiteOrchestrator (dev/up modes) and SiteController
 * (controller mode) behind a uniform interface. One process per site.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import type { SiteOrchestrator } from "../lib/site-orchestrator.js"
import type {
  SiteController,
  ControllerStatus,
  ReconcileResult,
} from "./controller.js"
import type {
  Executor,
  ComponentState,
  DeployResult,
} from "./execution/executor.js"
import type { HealthMonitor, HealthSnapshot } from "./health.js"
import type { SiteManifest } from "./manifest.js"

export type AgentMode = "dev" | "up" | "controller"

export interface AgentStatus {
  mode: AgentMode
  pid: number
  port: number
  startedAt: string
  uptime: string

  // From orchestrator (dev/up modes)
  project?: string
  sdSlug?: string
  site?: { slug: string; type: string }
  workbench?: { slug: string; type: string; tunnelSubdomain?: string }
  tunnel?: {
    status: "disconnected" | "connecting" | "connected" | "error"
    info?: { url: string; subdomain: string }
  }

  // From controller (controller mode)
  siteName?: string
  controllerMode?: string
  executorType: string
  manifestVersion?: number
  lastReconcileAt?: string | null
  lastReconcileResult?: ReconcileResult | null
  healthSnapshot?: HealthSnapshot | null
}

export interface SiteAgentConfig {
  mode: AgentMode
  port: number
  workingDir: string
}

export class SiteAgent {
  readonly mode: AgentMode
  readonly config: SiteAgentConfig
  readonly executor: Executor
  readonly orchestrator: SiteOrchestrator | null
  readonly controller: SiteController | null
  readonly healthMonitor: HealthMonitor | null
  readonly factoryUrl: string | null

  private startedAt: Date
  private serverHandle: { stop: () => void } | null = null
  private shutdownCallbacks: Array<() => void> = []

  constructor(opts: {
    config: SiteAgentConfig
    executor: Executor
    orchestrator?: SiteOrchestrator | null
    controller?: SiteController | null
    healthMonitor?: HealthMonitor | null
    factoryUrl?: string | null
  }) {
    this.mode = opts.config.mode
    this.config = opts.config
    this.executor = opts.executor
    this.orchestrator = opts.orchestrator ?? null
    this.controller = opts.controller ?? null
    this.healthMonitor = opts.healthMonitor ?? null
    this.factoryUrl = opts.factoryUrl ?? null
    this.startedAt = new Date()
  }

  getStatus(): AgentStatus {
    const now = new Date()
    const uptimeMs = now.getTime() - this.startedAt.getTime()
    const uptimeSecs = Math.floor(uptimeMs / 1000)
    const hours = Math.floor(uptimeSecs / 3600)
    const mins = Math.floor((uptimeSecs % 3600) / 60)
    const secs = uptimeSecs % 60

    const base: AgentStatus = {
      mode: this.mode,
      pid: process.pid,
      port: this.config.port,
      startedAt: this.startedAt.toISOString(),
      uptime: `${hours}h ${mins}m ${secs}s`,
      executorType: this.executor.type,
    }

    if (this.orchestrator) {
      const state = this.orchestrator.site.getState()
      base.project = this.orchestrator.project.name
      base.sdSlug = this.orchestrator.sdSlug
      base.site = state.spec.site
      base.workbench = state.spec.workbench
      base.tunnel = this.orchestrator.getTunnelState()
    }

    if (this.controller) {
      const cs = this.controller.getStatus()
      base.siteName = cs.siteName
      base.controllerMode = cs.mode
      base.manifestVersion = cs.manifestVersion
      base.lastReconcileAt = cs.lastReconcileAt
      base.lastReconcileResult = cs.lastReconcileResult
      base.healthSnapshot = cs.healthSnapshot
    } else if (this.healthMonitor) {
      base.healthSnapshot = this.healthMonitor.getLastSnapshot()
    }

    return base
  }

  /** Unified service list — works in both dev and controller modes. */
  async getServices(): Promise<Array<Record<string, unknown>>> {
    const actual = await this.executor.inspect()

    if (this.orchestrator) {
      // Dev/up mode: enriched with mode, ports, tunnel URLs, catalog metadata
      const sd = this.orchestrator.site.getSystemDeployment(
        this.orchestrator.sdSlug
      )
      const byName = new Map(
        (sd?.componentDeployments ?? []).map((c) => [c.componentSlug, c])
      )
      const tunnel = this.orchestrator.getTunnelState().info
      const portUrls = new Map(
        (tunnel?.portUrls ?? []).map((p) => [p.port, p.url])
      )
      const catalog = this.orchestrator.project.catalog
      const allocations = this.orchestrator.getPortAllocations()
      const allocByService = new Map<string, { name: string; port: number }[]>()
      for (const a of allocations) {
        const [svc, portName] = a.name.split("/")
        if (!svc || !portName) continue
        if (!allocByService.has(svc)) allocByService.set(svc, [])
        allocByService.get(svc)!.push({ name: portName, port: a.port })
      }

      return actual.map((s) => {
        const cd = byName.get(s.name)
        const entry = catalog.components[s.name] ?? catalog.resources[s.name]
        const catalogPorts = entry?.spec?.ports ?? []

        const ports = s.ports.map((p, idx) => {
          const cp =
            catalogPorts[idx] ??
            catalogPorts.find((x: any) => x.port === p.container)
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
            const cp = catalogPorts.find((x: any) => x.name === alloc.name)
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

        const deps = this.orchestrator!.graph.directDeps(s.name)

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
    }

    // Controller mode: simpler view with drift detection
    const manifest = this.controller?.getManifest()
    const desired = manifest?.componentDeployments ?? []
    const desiredMap = new Map(desired.map((cd) => [cd.componentName, cd]))

    return actual.map((s) => ({
      name: s.name,
      mode: "container",
      status: s.status,
      health: s.health,
      image: s.image,
      ports: s.ports,
      desired: desiredMap.get(s.name) ?? null,
      drift: desiredMap.get(s.name)?.desiredImage
        ? s.image !== desiredMap.get(s.name)!.desiredImage
        : false,
    }))
  }

  /** Detailed view of a single service. */
  async getServiceDetail(name: string): Promise<Record<string, unknown>> {
    if (this.orchestrator) {
      const sd = this.orchestrator.site.getSystemDeployment(
        this.orchestrator.sdSlug
      )
      const cd = sd?.componentDeployments.find((c) => c.componentSlug === name)
      const catalog = this.orchestrator.project.catalog
      const entry = catalog.components[name] ?? catalog.resources[name]
      if (!entry) {
        throw new Error(`Component ${name} not found in catalog`)
      }

      let actualState
      try {
        actualState = await this.executor.inspectOne(name)
      } catch {
        actualState = null
      }

      const deps = this.orchestrator.graph.transitiveDeps(name)

      return {
        name,
        catalog: entry,
        deployment: cd ?? null,
        actual: actualState,
        dependencies: deps,
      }
    }

    // Controller mode
    const actualState = await this.executor.inspectOne(name)
    return { name, actual: actualState }
  }

  /** Deploy a single service (controller mode: from manifest). */
  async deployService(name: string): Promise<DeployResult> {
    if (this.controller) {
      const manifest = this.controller.getManifest()
      const cd = manifest?.componentDeployments.find(
        (c) => c.componentName === name
      )
      if (!cd) {
        throw new Error(`Component ${name} not in manifest`)
      }
      return this.executor.deploy(name, {
        image: cd.desiredImage,
        replicas: cd.replicas,
        envOverrides: cd.envOverrides,
        resourceOverrides: cd.resourceOverrides,
      })
    }

    // Dev/up mode: delegate to orchestrator
    if (this.orchestrator) {
      const result = await this.orchestrator.startComponent(name)
      return {
        actualImage: "",
        status: "running",
      }
    }

    throw new Error("No controller or orchestrator available")
  }

  /** Stream service logs as SSE. */
  streamServiceLogs(
    name: string,
    set: any,
    activeStreams: Set<() => void>
  ): Response {
    const logPath = join(this.config.workingDir, ".dx", "dev", `${name}.log`)
    set.headers["content-type"] = "text/event-stream"
    set.headers["cache-control"] = "no-cache"
    set.headers["connection"] = "keep-alive"

    const encoder = new TextEncoder()
    let closed = false
    let close: () => void = () => {}

    // Determine whether to use file-based or Docker-based streaming
    const useFile =
      this.mode === "dev" &&
      this.orchestrator &&
      (() => {
        const sd = this.orchestrator!.site.getSystemDeployment(
          this.orchestrator!.sdSlug
        )
        const cd = sd?.componentDeployments.find(
          (c) => c.componentSlug === name
        )
        return cd?.mode === "native" || existsSync(logPath)
      })()

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
          // Docker compose log streaming
          const composeFiles =
            (this as any).orchestrator?.project.composeFiles ?? []
          const projectName = (this as any).orchestrator?.project.name ?? ""
          const rootDir =
            (this as any).orchestrator?.project.rootDir ??
            (this as any).config.workingDir
          const args = ["compose"]
          for (const f of composeFiles) {
            args.push("-f", f)
          }
          if (projectName) {
            args.push("-p", projectName)
          }
          args.push("logs", "-f", "--tail", "200", "--no-log-prefix", name)
          const proc = Bun.spawn(["docker", ...args], {
            cwd: rootDir,
            stdout: "pipe",
            stderr: "pipe",
          })
          close = () => {
            if (closed) return
            closed = true
            activeStreams.delete(close)
            try {
              proc.kill()
            } catch {}
            try {
              controller.close()
            } catch {}
          }
          activeStreams.add(close)

          const pump = async (s: ReadableStream<Uint8Array> | null) => {
            if (!s) return
            const reader = s.getReader()
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
  }

  /** Stream agent log file as SSE (for CLI attach mode). */
  streamAgentLogs(set: any, activeStreams: Set<() => void>): Response {
    const logPath = join(this.config.workingDir, ".dx", "agent.log")
    set.headers["content-type"] = "text/event-stream"
    set.headers["cache-control"] = "no-cache"

    const encoder = new TextEncoder()
    let closed = false
    let close: () => void

    const stream = new ReadableStream({
      start(controller) {
        let offset = existsSync(logPath) ? statSync(logPath).size : 0
        // Start from the last 4KB to show recent context on attach
        if (offset > 4096) {
          const tail = readFileSync(logPath)
            .subarray(offset - 4096, offset)
            .toString("utf8")
          const lines = tail.split("\n")
          // Skip first partial line
          for (let i = 1; i < lines.length; i++) {
            if (lines[i]) {
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(lines[i])}\n\n`)
                )
              } catch {}
            }
          }
        }

        let timer: ReturnType<typeof setTimeout> | null = null
        close = () => {
          if (closed) return
          closed = true
          if (timer) clearTimeout(timer)
          activeStreams.delete(close)
          try {
            controller.close()
          } catch {}
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
                  if (line) {
                    try {
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify(line)}\n\n`)
                      )
                    } catch {}
                  }
                }
              }
            }
          } catch {}
          if (!closed) timer = setTimeout(tick, 500)
        }
        tick()
      },
      cancel() {
        close!()
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    })
  }

  /** Register the server handle so shutdown can stop it. */
  setServerHandle(handle: { stop: () => void }): void {
    this.serverHandle = handle
  }

  /** Register a callback to run on shutdown. */
  onShutdown(cb: () => void): void {
    this.shutdownCallbacks.push(cb)
  }

  /** Graceful shutdown — stops everything. */
  shutdown(): void {
    // Stop controller loop if running
    if (this.controller?.isRunning()) {
      this.controller.stopLoop()
    }

    // Stop health monitor
    if (this.healthMonitor?.isRunning()) {
      this.healthMonitor.stop()
    }

    // Stop orchestrator (native processes, tunnel, etc.)
    if (this.orchestrator) {
      this.orchestrator.stop()
    }

    // Stop HTTP server
    if (this.serverHandle) {
      this.serverHandle.stop()
    }

    // Run registered callbacks
    for (const cb of this.shutdownCallbacks) {
      try {
        cb()
      } catch {}
    }

    process.exit(0)
  }
}
```

- [ ] **Step 2: Run type check**

```bash
cd cli && npx tsgo --noEmit src/site/agent.ts 2>&1 | head -30
```

Expected: Compiles cleanly (imports reference existing types).

- [ ] **Step 3: Commit**

```bash
git add cli/src/site/agent.ts
git commit -m "feat(site): add SiteAgent class — unified daemon coordinator"
```

---

### Task 3: Agent state file and daemon lifecycle

Create the daemon lifecycle management: spawning the agent as a detached background process, health checking, stopping, and attach/detach. Follows the same pattern as the existing `local-daemon/lifecycle.ts` but for site agents.

**Files:**

- Create: `cli/src/site/agent-lifecycle.ts`
- Read: `cli/src/local-daemon/lifecycle.ts` (pattern reference)

- [ ] **Step 1: Create the agent lifecycle module**

```typescript
// cli/src/site/agent-lifecycle.ts
/**
 * Site agent daemon lifecycle — spawn, stop, health-check, attach.
 *
 * The agent is a detached background process. CLI commands spawn it
 * and attach to its log stream; Ctrl+C detaches without killing.
 *
 * State file: .dx/agent.json
 * Log file: .dx/agent.log
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { spawn as cpSpawn, type ChildProcess } from "node:child_process"

import type { AgentMode } from "./agent.js"

// ── Agent state file ────────────────────────────────────────────────

export interface AgentState {
  pid: number
  port: number
  mode: AgentMode
  startedAt: string
  workingDir: string
}

export function agentStatePath(workingDir: string): string {
  return join(workingDir, ".dx", "agent.json")
}

export function agentLogPath(workingDir: string): string {
  return join(workingDir, ".dx", "agent.log")
}

export function readAgentState(workingDir: string): AgentState | null {
  const path = agentStatePath(workingDir)
  try {
    const raw = readFileSync(path, "utf-8").trim()
    return JSON.parse(raw) as AgentState
  } catch {
    return null
  }
}

export function writeAgentState(workingDir: string, state: AgentState): void {
  const dir = join(workingDir, ".dx")
  mkdirSync(dir, { recursive: true })
  writeFileSync(agentStatePath(workingDir), JSON.stringify(state, null, 2))
}

export function clearAgentState(workingDir: string): void {
  try {
    unlinkSync(agentStatePath(workingDir))
  } catch {}
}

// ── Process management ──────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Check whether a site agent is running and healthy.
 * Returns the agent state if healthy, null otherwise.
 */
export async function getRunningAgent(
  workingDir: string
): Promise<AgentState | null> {
  const state = readAgentState(workingDir)
  if (!state) return null

  // Check PID is alive
  if (!isProcessAlive(state.pid)) {
    clearAgentState(workingDir)
    return null
  }

  // Check health endpoint
  try {
    const res = await fetch(
      `http://localhost:${state.port}/api/v1/site/health`,
      { signal: AbortSignal.timeout(2000) }
    )
    if (res.ok) return state
  } catch {}

  // Process alive but not healthy — might be starting up
  return state
}

/**
 * Wait for the agent to become healthy (health endpoint responds OK).
 */
export async function waitForHealthy(
  port: number,
  timeoutMs = 30_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const healthUrl = `http://localhost:${port}/api/v1/site/health`

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, {
        signal: AbortSignal.timeout(1000),
      })
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }

  return false
}

// ── Spawn/Stop ──────────────────────────────────────────────────────

export interface SpawnAgentOpts {
  mode: AgentMode
  workingDir: string
  port: number

  // Session options (forwarded to the daemon)
  components?: string[]
  connectTo?: string
  connect?: string[]
  profile?: string
  env?: string[]
  noBuild?: boolean
  tunnel?: boolean
  exposeConsole?: boolean
  targets?: string[]
  profiles?: string[]
  detach?: boolean

  // Controller options
  siteName?: string
  standalone?: boolean
  airGapped?: boolean
  reconcileIntervalMs?: number
}

/**
 * Spawn the agent daemon as a detached background process.
 *
 * The daemon runs `dx __agent <mode>` with session config passed
 * as environment variables (avoiding CLI arg serialization issues).
 * Returns the expected port.
 */
export function spawnAgentDaemon(opts: SpawnAgentOpts): number {
  const dxDir = join(opts.workingDir, ".dx")
  mkdirSync(dxDir, { recursive: true })

  // Write session config to a file the daemon will read
  const configPath = join(dxDir, "agent-config.json")
  writeFileSync(configPath, JSON.stringify(opts, null, 2))

  // Resolve the dx binary — use process.argv[0] for compiled binary,
  // or the source entry point for development
  const dxBin = process.argv[0]!
  const isSourceMode = dxBin.endsWith("bun") || dxBin.includes("bun")

  const logFile = agentLogPath(opts.workingDir)
  const { openSync, closeSync } = require("node:fs") as typeof import("node:fs")
  const logFd = openSync(logFile, "a")

  let proc: ChildProcess
  if (isSourceMode) {
    // Running from source: bun run cli/src/site/agent-daemon.ts
    const daemonEntry = join(__dirname, "agent-daemon.ts")
    proc = cpSpawn("bun", ["--bun", daemonEntry, configPath], {
      stdio: ["ignore", logFd, logFd],
      detached: true,
      cwd: opts.workingDir,
      env: { ...process.env },
    })
  } else {
    // Running from compiled binary: dx __agent <config-path>
    proc = cpSpawn(dxBin, ["__agent", configPath], {
      stdio: ["ignore", logFd, logFd],
      detached: true,
      cwd: opts.workingDir,
      env: { ...process.env },
    })
  }

  proc.unref()
  closeSync(logFd)

  return opts.port
}

/**
 * Stop the running agent by sending SIGTERM.
 */
export async function stopAgent(workingDir: string): Promise<boolean> {
  const state = readAgentState(workingDir)
  if (!state) return false

  if (isProcessAlive(state.pid)) {
    process.kill(state.pid, "SIGTERM")
    // Wait briefly for process to exit
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (!isProcessAlive(state.pid)) break
    }
  }

  clearAgentState(workingDir)
  return true
}

// ── Attach ──────────────────────────────────────────────────────────

/**
 * Attach to a running agent's log stream (SSE).
 * Returns when the connection closes (user presses Ctrl+C).
 */
export async function attachToAgent(
  port: number,
  opts?: { quiet?: boolean }
): Promise<void> {
  const url = `http://localhost:${port}/api/v1/site/agent/logs`

  return new Promise<void>((resolve) => {
    let aborted = false

    const controller = new AbortController()

    const detach = () => {
      if (aborted) return
      aborted = true
      controller.abort()
      if (!opts?.quiet) {
        console.log("\nDetached from site agent. Agent is still running.")
        console.log("  Re-attach: dx dev (or dx up --attach)")
        console.log("  Stop:      dx dev stop (or dx site stop)")
      }
      resolve()
    }

    process.on("SIGINT", detach)
    process.on("SIGTERM", detach)

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          if (!opts?.quiet) {
            console.error(`Failed to attach: HTTP ${res.status}`)
          }
          resolve()
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""

        while (!aborted) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const text = JSON.parse(line.slice(6))
                process.stdout.write(text + "\n")
              } catch {
                // Not JSON — print raw
                process.stdout.write(line.slice(6) + "\n")
              }
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError" && !opts?.quiet) {
          console.error(
            `Agent connection lost: ${err instanceof Error ? err.message : err}`
          )
        }
      })
      .finally(() => {
        process.removeListener("SIGINT", detach)
        process.removeListener("SIGTERM", detach)
        resolve()
      })
  })
}
```

- [ ] **Step 2: Run type check**

```bash
cd cli && npx tsgo --noEmit src/site/agent-lifecycle.ts 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add cli/src/site/agent-lifecycle.ts
git commit -m "feat(site): add agent daemon lifecycle — spawn, stop, health, attach"
```

---

### Task 4: Agent daemon entry point

Create the daemon process entry point that the lifecycle module spawns. Also add a hidden `dx __agent` CLI command so the compiled binary can invoke it.

**Files:**

- Create: `cli/src/site/agent-daemon.ts`
- Modify: `cli/src/dx-root.ts` (add hidden `__agent` command)

- [ ] **Step 1: Create the daemon entry point**

```typescript
// cli/src/site/agent-daemon.ts
/**
 * Site agent daemon — entry point for the background process.
 *
 * Usage: bun agent-daemon.ts <config-path>
 *    or: dx __agent <config-path>
 *
 * Reads session config from the JSON file, creates a SiteAgent,
 * starts the unified HTTP server, runs the session, writes agent
 * state, and blocks forever.
 */
import { readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"

import { SiteAgent, type AgentMode } from "./agent.js"
import { createAgentServer } from "./agent-server.js"
import {
  writeAgentState,
  clearAgentState,
  type SpawnAgentOpts,
} from "./agent-lifecycle.js"

async function main() {
  const configPath = process.argv[2]
  if (!configPath) {
    console.error("Usage: agent-daemon <config-path>")
    process.exit(1)
  }

  const opts: SpawnAgentOpts = JSON.parse(readFileSync(configPath, "utf-8"))
  const { mode, workingDir, port } = opts

  console.log(`[agent] Starting in ${mode} mode (PID ${process.pid})`)
  console.log(`[agent] Working directory: ${workingDir}`)

  let agent: SiteAgent

  if (mode === "dev" || mode === "up") {
    // ── Dev/Up mode: create SiteOrchestrator and run session ──────
    const { SiteOrchestrator } = await import("../lib/site-orchestrator.js")

    const orch = await SiteOrchestrator.create({
      quiet: false,
      mode: mode === "up" ? "up" : undefined,
    })

    agent = new SiteAgent({
      config: { mode, port, workingDir },
      executor: orch.executor,
      orchestrator: orch,
      factoryUrl: orch.ctx.host.factory.url,
    })

    // Start the unified HTTP server BEFORE the session so the
    // health endpoint is available for the parent to poll
    const server = createAgentServer(agent, { port })
    const serverInfo = await server.start()
    agent.setServerHandle(server)

    console.log(`[agent] API server: http://localhost:${serverInfo.port}`)
    console.log(`[agent] Web UI: http://localhost:${serverInfo.port}`)

    // Write agent state so the parent knows we're alive
    writeAgentState(workingDir, {
      pid: process.pid,
      port: serverInfo.port,
      mode,
      startedAt: new Date().toISOString(),
      workingDir,
    })

    // Now run the actual session (Docker containers, native processes, etc.)
    if (mode === "dev") {
      const conn = await orch.startDevSession({
        components: opts.components,
        connectTo: opts.connectTo,
        connect: opts.connect,
        profile: opts.profile,
        env: opts.env,
        dryRun: false,
        restart: false,
        noBuild: opts.noBuild ?? false,
        tunnel: opts.tunnel ?? false,
        exposeConsole: opts.exposeConsole ?? false,
        quiet: false,
      })
      if (conn && conn.ctx.remoteDeps.length > 0) {
        await orch.checkRemoteHealth(conn.ctx, false)
      }
    } else {
      await orch.startUpSession({
        targets: opts.targets,
        profiles: opts.profiles,
        noBuild: opts.noBuild ?? false,
        detach: true,
        quiet: false,
      })
    }

    console.log(`[agent] Session started successfully`)
  } else {
    // ── Controller mode: create SiteController ───────────────────
    const { readConfig, resolveFactoryUrl } = await import("../config.js")
    const { SiteManager } = await import("../lib/site-manager.js")
    const { detectExecutor } = await import("./execution/detect.js")
    const { SiteController, type ControllerMode } = await import(
      "./controller.js"
    )
    const { FactoryLink } = await import("./factory-link.js")
    const { HealthMonitor } = await import("./health.js")
    const { StateStore } = await import("./state.js")

    // Load site identity
    const site = SiteManager.load(workingDir)
    const siteName =
      opts.siteName ??
      (site ? site.getState().spec.site.slug : undefined)
    if (!siteName) {
      throw new Error(
        "No site identity found. Run `dx setup --role site` first, or pass --name."
      )
    }

    const { executor } = await detectExecutor(workingDir)

    let controllerMode: ControllerMode = "connected"
    let factoryLink: FactoryLink | null = null
    let factoryUrl: string | null = null

    if (opts.standalone) {
      controllerMode = "standalone"
    } else if (opts.airGapped) {
      controllerMode = "air-gapped"
    } else {
      const config = await readConfig()
      factoryUrl = resolveFactoryUrl(config)
      if (factoryUrl) {
        factoryLink = new FactoryLink({ factoryUrl, siteName })
      } else {
        controllerMode = "standalone"
      }
    }

    const stateDir = join(workingDir, ".dx")
    const stateStore = new StateStore(stateDir)
    const healthMonitor = new HealthMonitor(
      executor,
      { intervalMs: 15_000 },
      (snapshot) => {
        if (snapshot.overallStatus !== "healthy") {
          console.warn(
            `[agent] Health degradation: ${snapshot.overallStatus}`
          )
        }
      }
    )

    const controller = new SiteController(
      {
        siteName,
        mode: controllerMode,
        reconcileIntervalMs: opts.reconcileIntervalMs ?? 30_000,
        workingDir,
      },
      executor,
      factoryLink,
      healthMonitor,
      stateStore
    )

    agent = new SiteAgent({
      config: { mode, port, workingDir },
      executor,
      controller,
      healthMonitor,
      factoryUrl,
    })

    const server = createAgentServer(agent, { port })
    const serverInfo = await server.start()
    agent.setServerHandle(server)

    console.log(`[agent] API server: http://localhost:${serverInfo.port}`)

    writeAgentState(workingDir, {
      pid: process.pid,
      port: serverInfo.port,
      mode,
      startedAt: new Date().toISOString(),
      workingDir,
    })

    // Start the reconcile loop
    const stopLoop = controller.startLoop()
    agent.onShutdown(stopLoop)

    console.log(
      `[agent] Controller running: ${siteName} (${controllerMode})`
    )
  }

  // ── Graceful shutdown ──────────────────────────────────────────────

  const shutdown = () => {
    console.log("[agent] Shutting down...")
    clearAgentState(workingDir)

    // Also clean up old controller.pid for backward compat
    try {
      unlinkSync(join(workingDir, ".dx", "controller.pid"))
    } catch {}

    agent.shutdown()
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  // Keep process alive
  await new Promise(() => {})
}

main().catch((err) => {
  console.error(`[agent] Fatal error: ${err}`)
  process.exit(1)
})
```

- [ ] **Step 2: Add hidden `__agent` command to the CLI root**

In `cli/src/dx-root.ts`, find where commands are registered and add:

```typescript
.command("__agent", (c) =>
  c
    .meta({ description: "Internal: run site agent daemon", hidden: true })
    .args([
      {
        name: "config-path",
        type: "string",
        required: true,
        description: "Path to agent config JSON",
      },
    ])
    .run(async ({ args }) => {
      // Dynamic import to keep the main CLI fast
      await import("./site/agent-daemon.js")
    })
)
```

Note: The `agent-daemon.ts` file runs `main()` on import, so the `__agent` command just needs to import it. The config path is read from `process.argv[2]` inside the daemon entry point.

- [ ] **Step 3: Run type check**

```bash
cd cli && npx tsgo --noEmit src/site/agent-daemon.ts 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add cli/src/site/agent-daemon.ts cli/src/dx-root.ts
git commit -m "feat(site): add agent daemon entry point and hidden __agent command"
```

---

### Task 5: Update `dx dev` — daemon-first startup

Rewrite the `dx dev` command to use the daemon pattern: run prelude/codegen in the foreground, spawn the agent daemon, wait for health, then attach to the log stream.

**Files:**

- Modify: `cli/src/commands/dev.ts`

- [ ] **Step 1: Rewrite the `dx dev` run handler**

Replace the main `.run()` handler in `devCommand()` (the block starting at line 98). Keep all the flag definitions and subcommands (`start`, `stop`, `restart`, `ps`, `logs`) unchanged.

```typescript
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)

      try {
        const ctx = await resolveDxContext({ need: "project" })
        const project = ctx.project
        const workingDir = project.rootDir

        // ── Check for running agent ─────────────────────────────
        const { getRunningAgent, spawnAgentDaemon, waitForHealthy, attachToAgent, stopAgent } =
          await import("../site/agent-lifecycle.js")

        const existing = await getRunningAgent(workingDir)
        if (existing) {
          if (!f.quiet) {
            console.log(
              `Site agent already running (PID ${existing.pid}, port ${existing.port})`
            )
            console.log(`Attaching to log stream... (Ctrl+C to detach)`)
          }
          await attachToAgent(existing.port, { quiet: f.quiet })
          return
        }

        // ── Setup phase (runs in foreground — user sees output) ──

        // Auto-connect
        const userConnect = flags.connect as string | string[] | undefined
        const coveredSystems = coveredSystemsFromConnectFlags(userConnect)
        const auto = autoConnectsFromDeps({
          catalog: project.catalog,
          hasConnectToFlag: Boolean(flags["connect-to"]),
          coveredSystems,
        })
        if (auto.errors.length > 0) {
          for (const err of auto.errors) console.error(`  ! ${err}`)
          exitWithError(
            f,
            `cannot resolve ${auto.errors.length} required system ${auto.errors.length === 1 ? "dependency" : "dependencies"}`
          )
          return
        }
        if (!f.quiet) {
          for (const log of auto.logs) console.log(log)
          for (const warn of auto.warnings) console.warn(`  ! ${warn}`)
        }
        const userConnectList = !userConnect
          ? []
          : Array.isArray(userConnect)
            ? userConnect
            : [userConnect]
        const effectiveConnectSpecific = [
          ...userConnectList,
          ...auto.autoConnects,
        ]
        const connectFlagForSession =
          effectiveConnectSpecific.length > 0
            ? effectiveConnectSpecific
            : undefined

        // Cached prelude (interactive — must run in foreground)
        await runPrelude(ctx, {
          noPrelude: flags.prelude === false,
          fresh: Boolean(flags.fresh),
          connectTo: flags["connect-to"] as string | undefined,
          connectProfile: flags.profile as string | undefined,
          connectSpecific: connectFlagForSession,
          quiet: Boolean(f.quiet),
        })

        // Pre-flight: run codegen (interactive — must run in foreground)
        const codegen = ctx.package?.toolchain.codegen ?? []
        if (codegen.length > 0 && !f.quiet) {
          if (flags["dry-run"]) {
            console.log(
              `  [dry-run] Would run ${codegen.length} code generator(s): ${codegen.map((g) => g.runCmd).join(", ")}`
            )
          } else {
            console.log(`  Running ${codegen.length} code generator(s)...`)
            for (const gen of codegen) {
              const [bin, ...genArgs] = gen.runCmd.split(" ")
              spawnSync(bin!, genArgs, {
                cwd: project.rootDir,
                stdio: "inherit",
                shell: true,
              })
            }
          }
        }

        if (flags["dry-run"]) {
          console.log("[dry-run] Would start site agent daemon")
          return
        }

        // ── Spawn daemon ────────────────────────────────────────
        const port = 4299 // same port the console used to use
        if (!f.quiet) {
          console.log(`  Starting site agent daemon...`)
        }

        spawnAgentDaemon({
          mode: "dev",
          workingDir,
          port,
          components: args.components,
          connectTo: flags["connect-to"] as string | undefined,
          connect: connectFlagForSession,
          profile: flags.profile as string | undefined,
          env: flags.env as string[] | undefined,
          noBuild: flags.build === false,
          tunnel: !!flags.tunnel,
          exposeConsole: !!flags["expose-console"],
        })

        // ── Wait for health ─────────────────────────────────────
        const healthy = await waitForHealthy(port, 60_000)
        if (!healthy) {
          const { agentLogPath } = await import("../site/agent-lifecycle.js")
          const logPath = agentLogPath(workingDir)
          exitWithError(
            f,
            `Site agent did not become healthy within 60s. Check logs: ${logPath}`
          )
          return
        }

        if (!f.quiet) {
          console.log(`  Site agent running (port ${port})`)
          console.log(`  Dev Console: http://localhost:${port}`)
          console.log(
            `${styleMuted("Attaching to agent logs. Press Ctrl+C to detach.")}`
          )
        }

        // ── Attach to log stream ────────────────────────────────
        await attachToAgent(port, { quiet: f.quiet })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
```

- [ ] **Step 2: Add `dx dev stop` to use the agent lifecycle**

Replace the existing `stop` subcommand handler to stop the agent daemon:

```typescript
    .command("stop", (c) =>
      c
        .meta({ description: "Stop the site agent and all dev servers" })
        .args([
          {
            name: "component",
            type: "string" as const,
            description: "Component name (stops agent if omitted)",
          },
        ])
        .run(async ({ args }) => {
          try {
            if (args.component) {
              // Stop a single component via the agent API
              const { getRunningAgent } = await import(
                "../site/agent-lifecycle.js"
              )
              const ctx = await resolveDxContext({ need: "project" })
              const state = await getRunningAgent(ctx.project.rootDir)
              if (!state) {
                console.log("No site agent running.")
                return
              }
              const res = await fetch(
                `http://localhost:${state.port}/api/v1/site/services/${args.component}/stop`,
                { method: "POST" }
              )
              if (!res.ok) {
                console.error(`Failed to stop ${args.component}`)
              } else {
                console.log(`Stopped ${args.component}`)
              }
              return
            }

            // Stop the entire agent
            const ctx = await resolveDxContext({ need: "project" })
            const { stopAgent } = await import(
              "../site/agent-lifecycle.js"
            )
            const stopped = await stopAgent(ctx.project.rootDir)
            if (stopped) {
              console.log("Site agent stopped.")
            } else {
              console.log("No site agent running.")
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`Error: ${msg}`)
            process.exit(1)
          }
        })
    )
```

- [ ] **Step 3: Run type check**

```bash
cd cli && npx tsgo --noEmit src/commands/dev.ts 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/dev.ts
git commit -m "feat(dev): rewrite dx dev to use site agent daemon with attach/detach"
```

---

### Task 6: Update `dx up` — daemon-first, default detached

Rewrite `dx up` to spawn the agent daemon in "up" mode. Default behavior: start and detach (don't attach to logs). Add `--attach` flag.

**Files:**

- Modify: `cli/src/commands/up.ts`

- [ ] **Step 1: Rewrite the `dx up` run handler**

Replace the main `.run()` handler in `upCommand()`.

Add an `attach` flag to the existing flags:

```typescript
      attach: {
        type: "boolean" as const,
        description: "Attach to agent logs after starting (default: false)",
      },
```

Replace the `.run()` handler:

```typescript
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags)
      try {
        const ctx = await resolveDxContext({ need: "project" })
        const project = ctx.project
        const workingDir = project.rootDir

        // ── Check for running agent ─────────────────────────────
        const {
          getRunningAgent,
          spawnAgentDaemon,
          waitForHealthy,
          attachToAgent,
        } = await import("../site/agent-lifecycle.js")

        const existing = await getRunningAgent(workingDir)
        if (existing) {
          if (!f.quiet) {
            console.log(
              `Site agent already running (PID ${existing.pid}, port ${existing.port})`
            )
          }
          if (flags.attach) {
            await attachToAgent(existing.port, { quiet: f.quiet })
          }
          return
        }

        // ── Auto-connect (same as dx dev) ────────────────────────
        const userConnect = flags.connect as string | string[] | undefined
        const coveredSystems = coveredSystemsFromConnectFlags(userConnect)
        const auto = autoConnectsFromDeps({
          catalog: project.catalog,
          hasConnectToFlag: Boolean(flags["connect-to"]),
          coveredSystems,
        })
        if (auto.errors.length > 0) {
          for (const err of auto.errors) console.error(`  ! ${err}`)
          exitWithError(
            f,
            `cannot resolve ${auto.errors.length} required system ${auto.errors.length === 1 ? "dependency" : "dependencies"}`
          )
          return
        }
        if (!f.quiet) {
          for (const log of auto.logs) console.log(log)
          for (const warn of auto.warnings) console.warn(`  ! ${warn}`)
        }
        const userConnectList = !userConnect
          ? []
          : Array.isArray(userConnect)
            ? userConnect
            : [userConnect]
        const effectiveConnect = [...userConnectList, ...auto.autoConnects]

        // ── Cached prelude ───────────────────────────────────────
        await runPrelude(ctx, {
          noPrelude: flags.prelude === false,
          fresh: Boolean(flags.fresh),
          connectTo: flags["connect-to"] as string | undefined,
          connectSpecific:
            effectiveConnect.length > 0 ? effectiveConnect : undefined,
          quiet: Boolean(f.quiet),
        })

        // ── Separate targets into profiles and services ──────────
        const knownProfiles = new Set(project.allProfiles)
        const rawTargets = args.targets ?? []
        const resolvedProfiles: string[] = []
        const services: string[] = []

        if (rawTargets.length === 0) {
          resolvedProfiles.push(...knownProfiles)
        } else {
          for (const target of rawTargets) {
            if (knownProfiles.has(target)) {
              resolvedProfiles.push(target)
            } else {
              services.push(target)
            }
          }
        }

        // ── Spawn daemon ────────────────────────────────────────
        const port = 4299
        if (!f.quiet) {
          console.log(`  Starting site agent daemon...`)
        }

        spawnAgentDaemon({
          mode: "up",
          workingDir,
          port,
          targets: services.length > 0 ? services : undefined,
          profiles: resolvedProfiles.length > 0 ? resolvedProfiles : undefined,
          noBuild: flags.build === false,
          connectTo: flags["connect-to"] as string | undefined,
          connect:
            effectiveConnect.length > 0 ? effectiveConnect : undefined,
        })

        // ── Wait for health ─────────────────────────────────────
        const healthy = await waitForHealthy(port, 60_000)
        if (!healthy) {
          const { agentLogPath } = await import(
            "../site/agent-lifecycle.js"
          )
          exitWithError(
            f,
            `Site agent did not become healthy within 60s. Check logs: ${agentLogPath(workingDir)}`
          )
          return
        }

        if (!f.json && !f.quiet) {
          const parts: string[] = []
          if (resolvedProfiles.length > 0)
            parts.push(`profiles: ${resolvedProfiles.join(", ")}`)
          if (services.length > 0)
            parts.push(`services: ${services.join(", ")}`)
          const detail = parts.length > 0 ? ` (${parts.join("; ")})` : ""
          console.log(`Stack started${detail} via site agent (port ${port})`)
        }

        if (flags.attach) {
          await attachToAgent(port, { quiet: f.quiet })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        exitWithError(f, msg)
      }
    })
```

- [ ] **Step 2: Add the missing imports**

Add at the top of the file:

```typescript
import { resolveDxContext } from "../lib/dx-context.js"
```

Remove the `SiteOrchestrator` import since we no longer create it directly.

- [ ] **Step 3: Run type check**

```bash
cd cli && npx tsgo --noEmit src/commands/up.ts 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add cli/src/commands/up.ts
git commit -m "feat(up): rewrite dx up to use site agent daemon"
```

---

### Task 7: Update `dx site` commands — unified agent lifecycle

Update `dx site start` to spawn the agent daemon in controller mode, `dx site stop` to use the agent lifecycle, and update API proxy commands to use the agent's unified endpoint.

**Files:**

- Modify: `cli/src/commands/site.ts`

- [ ] **Step 1: Rewrite `dx site start`**

Replace the `start` command handler:

```typescript
      .command("start", (c) =>
        c
          .meta({ description: "Start site agent in controller mode" })
          .flags({
            name: {
              type: "string",
              description: "Site name (reads from .dx/site.json if not set)",
            },
            standalone: {
              type: "boolean",
              description: "Run without Factory connection",
            },
            "air-gapped": {
              type: "boolean",
              description: "Run in air-gapped mode",
            },
            port: {
              type: "number",
              description: "Agent API port (default: 4590)",
            },
            interval: {
              type: "number",
              description: "Reconcile interval in seconds (default: 30)",
            },
            dir: {
              type: "string",
              description: "Working directory (default: cwd)",
            },
            attach: {
              type: "boolean",
              description: "Attach to agent logs after starting",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const workingDir = (flags.dir as string | undefined) ?? process.cwd()
            const port = (flags.port as number | undefined) ?? 4590

            const {
              getRunningAgent,
              spawnAgentDaemon,
              waitForHealthy,
              attachToAgent,
            } = await import("../site/agent-lifecycle.js")

            const existing = await getRunningAgent(workingDir)
            if (existing) {
              console.log(
                `Site agent already running (PID ${existing.pid}, port ${existing.port})`
              )
              if (flags.attach) {
                await attachToAgent(existing.port)
              }
              return
            }

            console.log("Starting site agent in controller mode...")

            spawnAgentDaemon({
              mode: "controller",
              workingDir,
              port,
              siteName: flags.name as string | undefined,
              standalone: flags.standalone as boolean | undefined,
              airGapped: flags["air-gapped"] as boolean | undefined,
              reconcileIntervalMs:
                ((flags.interval as number | undefined) ?? 30) * 1000,
            })

            const healthy = await waitForHealthy(port, 30_000)
            if (!healthy) {
              exitWithError(f, "Site agent did not become healthy within 30s")
              return
            }

            console.log(`Site agent running (PID file in .dx/agent.json, port ${port})`)

            if (flags.attach) {
              await attachToAgent(port)
            }
          })
      )
```

- [ ] **Step 2: Rewrite `dx site stop`**

Replace the `stop` command handler:

```typescript
      .command("stop", (c) =>
        c
          .meta({ description: "Stop site agent" })
          .flags({
            dir: {
              type: "string",
              description: "Working directory (default: cwd)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const workingDir =
              (flags.dir as string | undefined) ?? process.cwd()

            const { stopAgent } = await import("../site/agent-lifecycle.js")
            const stopped = await stopAgent(workingDir)

            if (stopped) {
              console.log("Site agent stopped.")
            } else {
              // Fall back to legacy controller.pid for backward compat
              const { existsSync, readFileSync } = await import("node:fs")
              const { join } = await import("node:path")
              const pidFile = join(workingDir, ".dx", "controller.pid")
              if (existsSync(pidFile)) {
                const pid = Number(readFileSync(pidFile, "utf8").trim())
                if (!Number.isNaN(pid)) {
                  try {
                    process.kill(pid, "SIGTERM")
                    console.log(
                      `Sent SIGTERM to legacy controller (PID ${pid}).`
                    )
                    return
                  } catch {}
                }
              }
              exitWithError(f, "No site agent or controller running.")
            }
          })
      )
```

- [ ] **Step 3: Update `getSiteApiUrl` to prefer the agent**

Replace the `getSiteApiUrl` function at the bottom of the file:

```typescript
async function getSiteApiUrl(): Promise<string> {
  // Prefer a running local agent
  const { getRunningAgent } = await import("../site/agent-lifecycle.js")
  const agent = await getRunningAgent(process.cwd())
  if (agent) {
    return `http://localhost:${agent.port}`
  }

  // Fall back to config-based resolution
  const config = await readConfig()
  const siteUrl = resolveSiteUrl(config)
  return siteUrl || resolveFactoryUrl(config)
}
```

- [ ] **Step 4: Run type check**

```bash
cd cli && npx tsgo --noEmit src/commands/site.ts 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/site.ts
git commit -m "feat(site): update dx site start/stop to use unified agent daemon"
```

---

### Task 8: Backward-compat `/api/dev/` route proxy in agent server

The React SPA currently calls `/api/dev/*`. Add a proxy layer in the agent server that forwards these requests to the unified `/api/v1/site/` routes so the existing UI works without changes.

**Files:**

- Modify: `cli/src/site/agent-server.ts`

- [ ] **Step 1: Add the backward-compat proxy**

After the main `app` definition in `createAgentServer`, replace the placeholder `devCompat` with a proper proxy:

```typescript
// ── Backward compat: proxy /api/dev/* → /api/v1/site/* ───────────
// The React SPA currently calls /api/dev/*. This proxy layer
// rewrites requests so the existing UI works during migration.

const devCompatRoutes: Record<string, string> = {
  "/api/dev/health": "/api/v1/site/health",
  "/api/dev/session": "/api/v1/site/session",
  "/api/dev/services": "/api/v1/site/services",
  "/api/dev/catalog": "/api/v1/site/catalog",
  "/api/dev/env": "/api/v1/site/env",
  "/api/dev/ports": "/api/v1/site/ports",
  "/api/dev/graph": "/api/v1/site/graph",
  "/api/dev/whoami": "/api/v1/site/whoami",
  "/api/dev/location": "/api/v1/site/location",
}

const devCompat = new Elysia({ prefix: "/api/dev" })
  .get("/health", () =>
    app.handle(new Request(`http://l/api/v1/site/health`)).then((r) => r.json())
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
    app.handle(new Request(`http://l/api/v1/site/ports`)).then((r) => r.json())
  )
  .get("/graph", () =>
    app.handle(new Request(`http://l/api/v1/site/graph`)).then((r) => r.json())
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
    app.handle(new Request(`http://l/api/v1/site/whoami`)).then((r) => r.json())
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
      .handle(new Request(`http://l/api/v1/site/threads/threads/${params.id}`))
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
      .handle(new Request(`http://l/api/v1/site/plans/${params.slug}/versions`))
      .then((r) => r.json())
  )
```

Then update the `start()` method to serve both the main app and compat routes:

```typescript
    async start() {
      let indexHtml: any
      try {
        indexHtml = (await import("../dev-console/ui/index.html")).default
      } catch {
        indexHtml = undefined
      }

      // Compose both Elysia apps
      const combinedApp = new Elysia()
        .use(app)
        .use(devCompat)

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
          : {},
        fetch: combinedApp.fetch,
        development:
          process.env.NODE_ENV !== "production" ? { hmr: true } : false,
      })

      const port = server.port ?? config.port
      return { port, url: `http://localhost:${port}` }
    },
```

- [ ] **Step 2: Run type check**

```bash
cd cli && npx tsgo --noEmit src/site/agent-server.ts 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add cli/src/site/agent-server.ts
git commit -m "feat(site): add /api/dev/ backward-compat proxy for React SPA"
```

---

### Task 9: Clean up — deprecate old server files

Mark the old controller-server and dev-console server as deprecated. Don't delete them yet (callers may still exist in tests or other entry points), but add deprecation notices and remove the standalone `startConsole()` method from `SiteOrchestrator`.

**Files:**

- Modify: `cli/src/site/controller-server.ts`
- Modify: `cli/src/dev-console/server.ts`
- Modify: `cli/src/lib/site-orchestrator.ts`
- Modify: `cli/src/site/start.ts`

- [ ] **Step 1: Add deprecation notice to controller-server.ts**

Add at the top of the file (after the existing doc comment):

```typescript
/**
 * @deprecated Use agent-server.ts instead. This file is kept for
 * backward compatibility with code that directly imports
 * createControllerServer. New code should use createAgentServer.
 */
```

- [ ] **Step 2: Add deprecation notice to dev-console/server.ts**

Add at the top of the file:

```typescript
/**
 * @deprecated Use agent-server.ts instead. This file is kept for
 * backward compatibility with code that directly imports
 * createDevConsoleServer. New code should use createAgentServer.
 */
```

- [ ] **Step 3: Update start.ts to use the agent daemon**

Replace `startSiteController` to delegate to the agent lifecycle:

```typescript
/**
 * @deprecated Use agent-daemon.ts instead. This function is kept
 * for backward compatibility.
 */
export async function startSiteController(opts: StartOptions): Promise<void> {
  console.warn(
    "startSiteController is deprecated. Use `dx site start` (agent daemon) instead."
  )
  // Fall through to legacy behavior for backward compat
  const identity = loadSiteIdentity(opts.workingDir, opts.siteName)
  const siteName = identity.slug

  console.log(`Starting site controller: ${siteName}`)
  console.log(`  Working directory: ${opts.workingDir}`)

  const { type: executorType, executor } = await detectExecutor(opts.workingDir)
  console.log(`  Executor: ${formatExecutorTypeLabel(executorType)}`)

  let mode: ControllerMode = "connected"
  let factoryLink: FactoryLink | null = null

  if (opts.standalone) {
    mode = "standalone"
  } else if (opts.airGapped) {
    mode = "air-gapped"
  } else {
    const config = await readConfig()
    const factoryUrl = resolveFactoryUrl(config)
    if (factoryUrl) {
      factoryLink = new FactoryLink({ factoryUrl, siteName })
    } else {
      mode = "standalone"
    }
  }

  const stateDir = join(opts.workingDir, ".dx")
  const state = new StateStore(stateDir)
  const healthMonitor = new HealthMonitor(
    executor,
    { intervalMs: 15_000 },
    (s) => {
      if (s.overallStatus !== "healthy")
        console.warn(`Health: ${s.overallStatus}`)
    }
  )

  const controller = new SiteController(
    {
      siteName,
      mode,
      reconcileIntervalMs: opts.reconcileIntervalMs,
      workingDir: opts.workingDir,
    },
    executor,
    factoryLink,
    healthMonitor,
    state
  )

  // Use the unified agent server instead of the old controller server
  const { SiteAgent } = await import("./agent.js")
  const { createAgentServer } = await import("./agent-server.js")
  const { writeAgentState, clearAgentState } =
    await import("./agent-lifecycle.js")

  const agent = new SiteAgent({
    config: {
      mode: "controller",
      port: opts.port,
      workingDir: opts.workingDir,
    },
    executor,
    controller,
    healthMonitor,
  })

  const agentServer = createAgentServer(agent, { port: opts.port })
  const serverInfo = await agentServer.start()
  agent.setServerHandle(agentServer)

  writeAgentState(opts.workingDir, {
    pid: process.pid,
    port: serverInfo.port,
    mode: "controller",
    startedAt: new Date().toISOString(),
    workingDir: opts.workingDir,
  })

  const stopLoop = controller.startLoop()

  console.log(
    `Site agent running (PID ${process.pid}, port ${serverInfo.port})`
  )

  const shutdown = () => {
    stopLoop()
    agentServer.stop()
    clearAgentState(opts.workingDir)
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  await new Promise(() => {})
}
```

- [ ] **Step 4: Remove startConsole() calls from SiteOrchestrator**

In `cli/src/lib/site-orchestrator.ts`, add a deprecation notice to `startConsole()`:

```typescript
  /**
   * @deprecated The dev console is now served by the unified agent server.
   * This method is kept for backward compatibility but is a no-op
   * when the agent daemon is managing the HTTP server.
   */
  async startConsole(): Promise<{ port: number; url: string }> {
    // ... existing implementation stays for backward compat
  }
```

- [ ] **Step 5: Run type check across all modified files**

```bash
cd cli && npx tsgo --noEmit 2>&1 | head -50
```

- [ ] **Step 6: Commit**

```bash
git add cli/src/site/controller-server.ts cli/src/dev-console/server.ts cli/src/site/start.ts cli/src/lib/site-orchestrator.ts
git commit -m "refactor(site): deprecate old server files, wire start.ts to unified agent"
```

---

### Summary: Unified API Route Map

After implementation, the unified API namespace at `/api/v1/site/` serves:

| Route                             | Source                                      | Modes      |
| --------------------------------- | ------------------------------------------- | ---------- |
| `GET /health`                     | Both                                        | all        |
| `GET /status`                     | Agent                                       | all        |
| `GET /catalog`                    | Both                                        | all        |
| `GET /services`                   | Dev console (enriched) + Controller (drift) | all        |
| `GET /services/:name`             | Dev console                                 | all        |
| `GET /services/:name/logs`        | Both                                        | all        |
| `GET /services/:name/logs/stream` | Dev console                                 | all        |
| `POST /services/:name/deploy`     | Controller                                  | all        |
| `POST /services/:name/restart`    | Controller                                  | all        |
| `POST /services/:name/stop`       | Controller                                  | all        |
| `POST /services/:name/run`        | Controller                                  | all        |
| `GET /services/:name/health`      | Controller                                  | all        |
| `POST /reconcile`                 | Controller                                  | controller |
| `GET /manifest`                   | Controller                                  | controller |
| `POST /manifest`                  | Controller                                  | controller |
| `GET /events`                     | Controller                                  | controller |
| `POST /init/:name/run`            | Controller                                  | all        |
| `GET /health-all`                 | Controller                                  | all        |
| `GET /session`                    | Dev console                                 | dev/up     |
| `POST /tunnel/start`              | Dev console                                 | dev        |
| `POST /tunnel/stop`               | Dev console                                 | dev        |
| `GET /env`                        | Dev console                                 | dev/up     |
| `GET /ports`                      | Dev console                                 | dev/up     |
| `GET /graph`                      | Dev console                                 | dev/up     |
| `GET /threads/*`                  | Dev console                                 | dev/up     |
| `GET /plans/*`                    | Dev console                                 | dev/up     |
| `GET /whoami`                     | Dev console                                 | all        |
| `GET /location`                   | Dev console                                 | all        |
| `GET /agent/logs`                 | Agent                                       | all        |
| `POST /agent/stop`                | Agent                                       | all        |

Backward-compat aliases at `/api/dev/*` proxy to the corresponding `/api/v1/site/*` routes.

---

### Follow-up Plans (not in scope)

1. **Kubernetes Executor** — implement `KubernetesExecutor` using `@kubernetes/client-node`, add ConfigMap-backed `StateStore`, observer mode
2. **UI Migration** — update React SPA `api-client.ts` to use `/api/v1/site/` directly, remove `/api/dev/` proxy
3. **Port Conflict Avoidance** — when multiple agents run on one host (multi-worktree), coordinate port allocation across agents
