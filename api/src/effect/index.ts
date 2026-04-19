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

// Ontology
export {
  Ontology,
  type OntologyService,
  type EntityAccessor,
  makeEntityAccessor,
} from "./services/ontology"
export { OntologyLive } from "./layers/ontology"

// Spec resolver
export { SpecResolver, type ResolveScope } from "./services/spec-resolver"
export { SpecResolverLive } from "./layers/spec-resolver"

// DNS
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
export { runEffect } from "./bridge"

// Runtime
export { createAppLayer, type AppLayer } from "./runtime"
