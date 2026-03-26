import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { GatewayModel } from "./gateway.model"
import * as gw from "./gateway.service"
import { createTunnelHandlers } from "./tunnel-broker"

export function gatewayController(db: Database) {
  return new Elysia({ prefix: "/gateway" })
    // ---- Routes ----
    .get("/routes", ({ query }) => gw.listRoutes(db, query), {
      query: GatewayModel.routeListQuery,
      detail: { tags: ["Gateway"], summary: "List routes" },
    })
    .post(
      "/routes",
      ({ body }) => gw.createRoute(db, { ...body, createdBy: "system", expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined }),
      {
        body: GatewayModel.createRouteBody,
        detail: { tags: ["Gateway"], summary: "Create route" },
      }
    )
    .get(
      "/routes/:id",
      ({ params }) => gw.getRoute(db, params.id),
      {
        params: GatewayModel.routeIdParams,
        detail: { tags: ["Gateway"], summary: "Get route" },
      }
    )
    .patch(
      "/routes/:id",
      ({ params, body }) => gw.updateRoute(db, params.id, {
        ...body,
        expiresAt: body.expiresAt === null ? null : body.expiresAt ? new Date(body.expiresAt) : undefined,
      }),
      {
        params: GatewayModel.routeIdParams,
        body: GatewayModel.updateRouteBody,
        detail: { tags: ["Gateway"], summary: "Update route" },
      }
    )
    .delete(
      "/routes/:id",
      ({ params }) => gw.deleteRoute(db, params.id),
      {
        params: GatewayModel.routeIdParams,
        detail: { tags: ["Gateway"], summary: "Delete route" },
      }
    )

    // ---- Domains ----
    .get("/domains", ({ query }) => gw.listDomains(db, query), {
      query: GatewayModel.domainListQuery,
      detail: { tags: ["Gateway"], summary: "List domains" },
    })
    .post(
      "/domains",
      ({ body }) => gw.registerDomain(db, { ...body, createdBy: "system" }),
      {
        body: GatewayModel.createDomainBody,
        detail: { tags: ["Gateway"], summary: "Register custom domain" },
      }
    )
    .get(
      "/domains/:id",
      ({ params }) => gw.getDomain(db, params.id),
      {
        params: GatewayModel.domainIdParams,
        detail: { tags: ["Gateway"], summary: "Get domain" },
      }
    )
    .delete(
      "/domains/:id",
      ({ params }) => gw.removeDomain(db, params.id),
      {
        params: GatewayModel.domainIdParams,
        detail: { tags: ["Gateway"], summary: "Remove domain" },
      }
    )
    .post(
      "/domains/:id/verify",
      ({ params }) => gw.verifyDomain(db, params.id),
      {
        params: GatewayModel.domainIdParams,
        detail: { tags: ["Gateway"], summary: "Verify domain DNS" },
      }
    )

    // ---- Tunnels ----
    .get("/tunnels", ({ query }) => gw.listTunnels(db, query), {
      query: GatewayModel.tunnelListQuery,
      detail: { tags: ["Gateway"], summary: "List active tunnels" },
    })
    .delete(
      "/tunnels/:id",
      ({ params }) => gw.closeTunnel(db, params.id),
      {
        params: GatewayModel.tunnelIdParams,
        detail: { tags: ["Gateway"], summary: "Force-close tunnel" },
      }
    )
    .ws("/tunnels/ws", (() => {
      const handlers = createTunnelHandlers({ db });
      return {
        open(ws: any) { handlers.open(ws.raw as unknown as WebSocket); },
        async message(ws: any, data: any) { await handlers.message(ws.raw as unknown as WebSocket, data); },
        async close(ws: any) { await handlers.close(ws.raw as unknown as WebSocket); },
      };
    })())
    .onStart(async () => {
      const { startGateway } = await import("./gateway-proxy");
      const { getTunnelStreamManager } = await import("./tunnel-broker");
      startGateway({ db, port: 9090, getTunnelStreamManager });
    })
}
