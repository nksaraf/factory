import { t } from "elysia"

export const SiteModel = {
  pushManifestBody: t.Object({
    manifestVersion: t.Number(),
    manifestHash: t.String(),
    targetRelease: t.Union([
      t.Object({
        releaseId: t.String(),
        releaseVersion: t.String(),
        modulePins: t.Array(
          t.Object({
            moduleVersionId: t.String(),
            moduleName: t.String(),
            version: t.String(),
          })
        ),
      }),
      t.Null(),
    ]),
    configuration: t.Record(t.String(), t.Unknown()),
    routes: t.Array(
      t.Object({
        routeId: t.String(),
        kind: t.String(),
        domain: t.String(),
        pathPrefix: t.Optional(t.Union([t.String(), t.Null()])),
        targetService: t.String(),
        targetPort: t.Optional(t.Union([t.Number(), t.Null()])),
        protocol: t.String(),
        tlsMode: t.String(),
        middlewares: t.Array(t.Unknown()),
        priority: t.Number(),
      })
    ),
    domains: t.Array(
      t.Object({
        domainId: t.String(),
        fqdn: t.String(),
        kind: t.String(),
        tlsCertRef: t.Optional(t.Union([t.String(), t.Null()])),
      })
    ),
  }),
}
