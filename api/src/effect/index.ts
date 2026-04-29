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

// Graph — typed entity access derived from IR + table bindings
export {
  Graph,
  type GraphService,
  type EntityAccessor,
  makeEntityAccessor,
} from "./services/graph"
export { FACTORY_BINDINGS } from "../db/bindings"
export { GraphLive } from "./layers/graph"

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

// DNS resolver — hostname resolution for trace pipeline
export {
  DnsResolver,
  DnsResolutionError,
  type DnsEntity,
  type DnsRecord,
  type DnsResolution,
} from "./services/dns-resolver"
export { DnsResolverLive, findDnsDomainForHost } from "./layers/dns-resolver"

// Trace — request-aware network graph traversal
export {
  Trace,
  TraceError,
  TraceStartNotFoundError,
  parseRequestInput,
  makeTrace,
  type TraceResult,
} from "./services/trace"
export { TraceLive } from "./layers/trace"

// Runtime — full service stack (Db + Config + Secrets + SpecResolver + Graph + DnsResolver + Trace)
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
