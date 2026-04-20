// Database layer
export {
  Db,
  makeDbLayer,
  DatabaseError,
  classifyDatabaseError,
  query,
  queryOrNotFound,
  withTransaction,
  type DatabaseErrorVariant,
} from "./layers/database"

// Config layer
export { FactoryConfig, makeConfigLayer } from "./layers/config"

// Ontology — typed entity access derived from IR + table bindings
export {
  Ontology,
  type OntologyService,
  type EntityAccessor,
  makeEntityAccessor,
} from "./services/ontology"
export { FACTORY_BINDINGS } from "./factory-bindings"
export { OntologyLive } from "./layers/ontology"

// Spec resolver — $secret() and $var() resolution
export { SpecResolver, type ResolveScope } from "./services/spec-resolver"
export { SpecResolverLive } from "./layers/spec-resolver"

// DNS provider
export {
  DnsProvider,
  DnsApiError,
  DnsAuthError,
  DnsZoneNotFoundError,
  type DnsError,
} from "./services/dns"
export { makeDnsProviderLayer } from "./layers/dns"

// Secrets
export { Secrets, SecretDecryptionError } from "./services/secrets"
export { SecretsLive } from "./layers/secrets"

// Bridge
export { runEffect, runWithRuntime } from "./bridge"

// Runtime — full service stack (Db + Config + Secrets + SpecResolver + Ontology)
export { createAppLayer, type AppLayer } from "./runtime"

// Reconciliation framework
export {
  diffSets,
  reconcileSet,
  Reconciler,
  createReconcilerRuntime,
  type SetDiff,
  type ReconcileSetResult,
  type ReconcilerDef,
  type ReconcilerRuntime,
  type ReconcilerStatus,
} from "./reconcile/index"
