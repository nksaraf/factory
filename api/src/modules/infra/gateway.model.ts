import { type UnwrapSchema, t } from "elysia"

export const GatewayModel = {
  // Routes
  createRouteBody: t.Object({
    siteId: t.Optional(t.String()),
    systemDeploymentId: t.Optional(t.String()),
    clusterId: t.Optional(t.String()),
    type: t.String(),
    domain: t.String(),
    pathPrefix: t.Optional(t.String()),
    targetService: t.String(),
    targetPort: t.Optional(t.Number()),
    protocol: t.Optional(t.String()),
    tlsMode: t.Optional(t.String()),
    tlsCertRef: t.Optional(t.String()),
    priority: t.Optional(t.Number()),
    middlewares: t.Optional(t.Array(t.String())),
    metadata: t.Optional(t.Record(t.String(), t.Unknown())),
    expiresAt: t.Optional(t.String()),
  }),
  updateRouteBody: t.Object({
    status: t.Optional(t.String()),
    targetService: t.Optional(t.String()),
    targetPort: t.Optional(t.Number()),
    tlsMode: t.Optional(t.String()),
    tlsCertRef: t.Optional(t.String()),
    priority: t.Optional(t.Number()),
    middlewares: t.Optional(t.Array(t.String())),
    metadata: t.Optional(t.Record(t.String(), t.Unknown())),
    expiresAt: t.Optional(t.Nullable(t.String())),
  }),
  routeIdParams: t.Object({ id: t.String() }),
  routeListQuery: t.Object({
    type: t.Optional(t.String()),
    siteId: t.Optional(t.String()),
    status: t.Optional(t.String()),
    systemDeploymentId: t.Optional(t.String()),
  }),

  // Domains
  createDomainBody: t.Object({
    siteId: t.Optional(t.String()),
    fqdn: t.String(),
    type: t.String(),
  }),
  domainIdParams: t.Object({ id: t.String() }),
  domainListQuery: t.Object({
    siteId: t.Optional(t.String()),
    status: t.Optional(t.String()),
  }),

  // Tunnels
  tunnelIdParams: t.Object({ id: t.String() }),
  tunnelListQuery: t.Object({
    principalId: t.Optional(t.String()),
    status: t.Optional(t.String()),
  }),
} as const

export type GatewayModels = {
  [K in keyof typeof GatewayModel]: UnwrapSchema<(typeof GatewayModel)[K]>
}
