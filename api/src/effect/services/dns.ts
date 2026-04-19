/**
 * DNS Provider Effect service — domain errors + service tag.
 *
 * Wraps the DnsProviderAdapter interface in Effect-typed errors so DNS
 * operations compose cleanly with other Effect services (DB, config, etc.).
 */

import { Context, Data, Effect } from "effect"
import type {
  DnsZone,
  DnsRecordEntry,
  CreateDnsRecordInput,
  UpdateDnsRecordInput,
} from "../../adapters/dns-provider-adapter"

// ---------------------------------------------------------------------------
// DNS-specific errors
// ---------------------------------------------------------------------------

export class DnsApiError extends Data.TaggedError("DnsApiError")<{
  readonly provider: string
  readonly operation: string
  readonly statusCode?: number
  readonly responseBody?: string
  readonly message: string
}> {
  get httpStatus(): number {
    return 502
  }
}

export class DnsAuthError extends Data.TaggedError("DnsAuthError")<{
  readonly provider: string
  readonly message: string
}> {
  get httpStatus(): number {
    return 401
  }
}

export class DnsZoneNotFoundError extends Data.TaggedError(
  "DnsZoneNotFoundError"
)<{
  readonly zoneId: string
  readonly message: string
}> {
  get httpStatus(): number {
    return 404
  }
}

export type DnsError = DnsApiError | DnsAuthError | DnsZoneNotFoundError

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class DnsProvider extends Context.Tag("DnsProvider")<
  DnsProvider,
  {
    readonly listZones: Effect.Effect<DnsZone[], DnsApiError | DnsAuthError>
    readonly listRecords: (
      zoneId: string
    ) => Effect.Effect<
      DnsRecordEntry[],
      DnsApiError | DnsAuthError | DnsZoneNotFoundError
    >
    readonly createRecord: (
      zoneId: string,
      record: CreateDnsRecordInput
    ) => Effect.Effect<DnsRecordEntry, DnsApiError | DnsAuthError>
    readonly updateRecord: (
      zoneId: string,
      recordId: string,
      record: UpdateDnsRecordInput
    ) => Effect.Effect<DnsRecordEntry, DnsApiError | DnsAuthError>
    readonly deleteRecord: (
      zoneId: string,
      recordId: string
    ) => Effect.Effect<void, DnsApiError | DnsAuthError>
  }
>() {}
