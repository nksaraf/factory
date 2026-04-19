/**
 * Ontology live layer — constructs all typed entity accessors from Db context.
 *
 * Also provides dynamic `get(kind, slugOrId)` using getRegistry()
 * for runtime-determined entity types.
 */

import { Effect, Layer } from "effect"
import { EntityNotFoundError } from "@smp/factory-shared/effect/errors"

import { Db, type DatabaseError } from "./database"
import { Ontology, makeEntityAccessor } from "../services/ontology"
// Lazy import to avoid circular dependency (ontology-registry imports from modules).
// Uses dynamic import() wrapped in Effect instead of CJS require().
const loadRegistry = () =>
  Effect.promise(async () => {
    const mod = await import("../../lib/ontology-registry")
    return mod.ONTOLOGY_REGISTRY as Map<
      string,
      { table: any; slugColumn: any; idColumn: any }
    >
  })

// Slug-based ontology tables
import {
  estate,
  host,
  realm,
  service,
  route,
  dnsDomain,
  networkLink,
} from "../../db/schema/infra"
import {
  system,
  component,
  softwareApi,
  template,
  product,
  capability,
} from "../../db/schema/software"
import { team, principal, agent } from "../../db/schema/org"
import { site, systemDeployment, workbench } from "../../db/schema/ops"
import { repo, gitHostProvider } from "../../db/schema/build"

export const OntologyLive = Layer.effect(
  Ontology,
  Effect.gen(function* () {
    const db = yield* Db

    // Dynamic accessor using ONTOLOGY_REGISTRY for runtime-determined kinds
    const dynamicGet = (kind: string, slugOrId: string) =>
      Effect.flatMap(loadRegistry(), (registry) => {
        const entry = registry.get(kind)
        if (!entry) {
          return Effect.fail(
            new EntityNotFoundError({ entity: kind, identifier: slugOrId })
          )
        }
        return makeEntityAccessor(
          db,
          kind,
          entry.table,
          entry.slugColumn,
          entry.idColumn
        ).get(slugOrId)
      }) as Effect.Effect<
        Record<string, unknown>,
        DatabaseError | EntityNotFoundError
      >

    const dynamicFind = (kind: string, slugOrId: string) =>
      Effect.flatMap(loadRegistry(), (registry) => {
        const entry = registry.get(kind)
        if (!entry) return Effect.succeed(null)
        return makeEntityAccessor(
          db,
          kind,
          entry.table,
          entry.slugColumn,
          entry.idColumn
        ).find(slugOrId)
      }) as Effect.Effect<Record<string, unknown> | null, DatabaseError>

    return {
      // Infra
      estate: makeEntityAccessor(db, "estate", estate, estate.slug, estate.id),
      host: makeEntityAccessor(db, "host", host, host.slug, host.id),
      realm: makeEntityAccessor(db, "realm", realm, realm.slug, realm.id),
      service: makeEntityAccessor(
        db,
        "service",
        service,
        service.slug,
        service.id
      ),
      route: makeEntityAccessor(db, "route", route, route.slug, route.id),
      dnsDomain: makeEntityAccessor(
        db,
        "dns-domain",
        dnsDomain,
        dnsDomain.slug,
        dnsDomain.id
      ),
      networkLink: makeEntityAccessor(
        db,
        "network-link",
        networkLink,
        networkLink.slug,
        networkLink.id
      ),

      // Software
      system: makeEntityAccessor(db, "system", system, system.slug, system.id),
      component: makeEntityAccessor(
        db,
        "component",
        component,
        component.slug,
        component.id
      ),
      api: makeEntityAccessor(
        db,
        "api",
        softwareApi,
        softwareApi.slug,
        softwareApi.id
      ),
      template: makeEntityAccessor(
        db,
        "template",
        template,
        template.slug,
        template.id
      ),
      product: makeEntityAccessor(
        db,
        "product",
        product,
        product.slug,
        product.id
      ),
      capability: makeEntityAccessor(
        db,
        "capability",
        capability,
        capability.slug,
        capability.id
      ),

      // Org
      team: makeEntityAccessor(db, "team", team, team.slug, team.id),
      principal: makeEntityAccessor(
        db,
        "principal",
        principal,
        principal.slug,
        principal.id
      ),
      agent: makeEntityAccessor(db, "agent", agent, agent.slug, agent.id),

      // Ops
      site: makeEntityAccessor(db, "site", site, site.slug, site.id),
      systemDeployment: makeEntityAccessor(
        db,
        "system-deployment",
        systemDeployment,
        systemDeployment.slug,
        systemDeployment.id
      ),
      workbench: makeEntityAccessor(
        db,
        "workbench",
        workbench,
        workbench.slug,
        workbench.id
      ),

      // Build
      repo: makeEntityAccessor(db, "repository", repo, repo.slug, repo.id),
      gitHostProvider: makeEntityAccessor(
        db,
        "git-host-provider",
        gitHostProvider,
        gitHostProvider.slug,
        gitHostProvider.id
      ),

      // Dynamic
      get: dynamicGet,
      find: dynamicFind,
    }
  })
)
