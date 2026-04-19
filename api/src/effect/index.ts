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

// Ontology — typed entity access derived from ENTITY_MAP
export {
  Ontology,
  ENTITY_MAP,
  type OntologyService,
  type EntityAccessor,
  makeEntityAccessor,
} from "./services/ontology"
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
