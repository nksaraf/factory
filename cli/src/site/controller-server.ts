/**
 * Site controller HTTP API server.
 *
 * Exposes operational endpoints under /api/v1/site/ for operators
 * and Factory to interact with the running controller.
 */
import { Elysia, t } from "elysia"

import type { SiteController } from "./controller.js"

export interface ControllerServerConfig {
  port: number
  hostname?: string
}

export function createControllerServer(
  controller: SiteController,
  config: ControllerServerConfig
) {
  const app = new Elysia({ prefix: "/api/v1/site" })

    .get("/status", () => {
      return { data: controller.getStatus() }
    })

    .get("/catalog", async () => {
      try {
        const catalog = await controller.executor.parseCatalog()
        return { data: catalog }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })

    .get("/components", async () => {
      const actual = await controller.executor.inspect()
      const manifest = controller.getManifest()
      const desired = manifest?.componentDeployments ?? []

      const desiredMap = new Map(desired.map((cd) => [cd.componentName, cd]))

      const components = actual.map((s) => ({
        name: s.name,
        actual: {
          image: s.image,
          status: s.status,
          health: s.health,
        },
        desired: desiredMap.get(s.name) ?? null,
        drift: desiredMap.get(s.name)?.desiredImage
          ? s.image !== desiredMap.get(s.name)!.desiredImage
          : false,
      }))

      return { data: components }
    })

    .post(
      "/components/:name/deploy",
      async ({ params, set }) => {
        const manifest = controller.getManifest()
        const cd = manifest?.componentDeployments.find(
          (c) => c.componentName === params.name
        )
        if (!cd) {
          set.status = 404
          return { error: `Component ${params.name} not in manifest` }
        }
        const result = await controller.executor.deploy(params.name, {
          image: cd.desiredImage,
          replicas: cd.replicas,
          envOverrides: cd.envOverrides,
          resourceOverrides: cd.resourceOverrides,
        })
        return { data: result }
      },
      {
        params: t.Object({ name: t.String() }),
      }
    )

    .post(
      "/components/:name/restart",
      async ({ params }) => {
        await controller.executor.restart(params.name)
        return { data: { restarted: params.name } }
      },
      {
        params: t.Object({ name: t.String() }),
      }
    )

    .post(
      "/components/:name/stop",
      async ({ params }) => {
        await controller.executor.stop(params.name)
        return { data: { stopped: params.name } }
      },
      {
        params: t.Object({ name: t.String() }),
      }
    )

    .get(
      "/components/:name/logs",
      async ({ params, query }) => {
        const tail = query.tail ? Number(query.tail) : undefined
        const since = query.since as string | undefined
        const logs = await controller.executor.logs(params.name, {
          tail,
          since,
        })
        return { data: logs }
      },
      {
        params: t.Object({ name: t.String() }),
      }
    )

    .post(
      "/components/:name/run",
      async ({ params, body }) => {
        const result = await controller.executor.run(params.name, body.cmd)
        return { data: result }
      },
      {
        params: t.Object({ name: t.String() }),
        body: t.Object({ cmd: t.Array(t.String()) }),
      }
    )

    .get(
      "/components/:name/health",
      async ({ params }) => {
        const health = await controller.executor.healthCheck(params.name)
        return { data: { component: params.name, health } }
      },
      {
        params: t.Object({ name: t.String() }),
      }
    )

    .post("/reconcile", async () => {
      const result = await controller.reconcile()
      return { data: result }
    })

    .get("/manifest", () => {
      const manifest = controller.getManifest()
      if (!manifest) {
        return { error: "No manifest loaded" }
      }
      return { data: manifest }
    })

    .post("/manifest", async ({ body, set }) => {
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
      controller.setManifest(m as any)
      const result = await controller.reconcile()
      return { data: result }
    })

    .get("/health", async () => {
      const health = await controller.executor.healthCheckAll()
      return { data: health }
    })

    .post(
      "/init/:name/run",
      async ({ params }) => {
        const result = await controller.executor.runInit(params.name)
        return { data: result }
      },
      {
        params: t.Object({ name: t.String() }),
      }
    )

    .get("/events", () => {
      return { data: controller.getEvents() }
    })

  return {
    app,
    async start() {
      const server = Bun.serve({
        fetch: app.fetch,
        port: config.port,
        hostname: config.hostname ?? "0.0.0.0",
      })
      return server
    },
  }
}
