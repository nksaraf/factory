/**
 * Application layer composition — the full Effect service stack.
 *
 * `createAppLayer(db, settings)` provides all core services:
 *   - Db (Drizzle database)
 *   - FactoryConfig (application settings)
 *   - Secrets (encrypted secret storage)
 *   - SpecResolver ($secret/$var resolution)
 *   - Ontology (typed entity access)
 *
 * Controllers just call `runEffect(Effect.provide(program, appLayer))` —
 * no manual layer assembly per route.
 */

import { Layer } from "effect"
import type { Database } from "../db/connection"
import type { FactorySettings } from "../settings"
import { makeDbLayer } from "./layers/database"
import { makeConfigLayer } from "./layers/config"
import { SecretsLive } from "./layers/secrets"
import { SpecResolverLive } from "./layers/spec-resolver"
import { OntologyLive } from "./layers/ontology"

/**
 * Build the full application layer from a Database and FactorySettings.
 *
 * Layer dependency graph:
 *   Db + FactoryConfig (base)
 *     └→ SecretsLive (depends on Db)
 *         └→ SpecResolverLive (depends on Db + Secrets)
 *     └→ OntologyLive (depends on Db)
 */
export function createAppLayer(db: Database, settings?: FactorySettings) {
  const base = settings
    ? Layer.mergeAll(makeDbLayer(db), makeConfigLayer(settings))
    : makeDbLayer(db)

  // SecretsLive depends on Db
  const withSecrets = Layer.provideMerge(SecretsLive, base)

  // SpecResolverLive depends on Db + Secrets
  const withSpecResolver = Layer.provideMerge(SpecResolverLive, withSecrets)

  // OntologyLive depends on Db
  const withOntology = Layer.provideMerge(OntologyLive, withSpecResolver)

  return withOntology
}

export type AppLayer = Layer.Layer.Success<ReturnType<typeof createAppLayer>>
