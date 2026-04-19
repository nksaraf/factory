/**
 * DNS Provider live layer — wraps a DnsProviderAdapter in the Effect service.
 *
 * Constructor-configured pattern: call `makeDnsProviderLayer(adapter)` with an
 * already-instantiated adapter (from `getDnsProviderAdapter()` in the adapter
 * registry) to produce a Layer that satisfies the DnsProvider service tag.
 */

import { Effect, Layer } from "effect"
import type { DnsProviderAdapter } from "../../adapters/dns-provider-adapter"
import { DnsProvider, DnsApiError, DnsAuthError } from "../services/dns"

function classifyDnsError(
  provider: string,
  operation: string,
  error: unknown
): DnsApiError | DnsAuthError {
  if (!(error instanceof Error)) {
    return new DnsApiError({ provider, operation, message: String(error) })
  }

  const msg = error.message.toLowerCase()

  // Cloudflare returns 403 for bad tokens, others may vary
  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden")
  ) {
    return new DnsAuthError({ provider, message: error.message })
  }

  // Parse HTTP status from error messages like "Cloudflare API GET /zones: 429 Too Many Requests"
  const statusMatch = error.message.match(/:\s*(\d{3})\s/)

  return new DnsApiError({
    provider,
    operation,
    statusCode: statusMatch ? Number(statusMatch[1]) : undefined,
    responseBody: error.message,
    message: error.message,
  })
}

export function makeDnsProviderLayer(
  adapter: DnsProviderAdapter
): Layer.Layer<DnsProvider> {
  const provider = adapter.type

  return Layer.succeed(DnsProvider, {
    listZones: Effect.tryPromise({
      try: () => adapter.listZones(),
      catch: (err) => classifyDnsError(provider, "listZones", err),
    }),

    listRecords: (zoneId) =>
      Effect.tryPromise({
        try: () => adapter.listRecords(zoneId),
        catch: (err) => classifyDnsError(provider, "listRecords", err),
      }),

    createRecord: (zoneId, record) =>
      Effect.tryPromise({
        try: () => adapter.createRecord(zoneId, record),
        catch: (err) => classifyDnsError(provider, "createRecord", err),
      }),

    updateRecord: (zoneId, recordId, record) =>
      Effect.tryPromise({
        try: () => adapter.updateRecord(zoneId, recordId, record),
        catch: (err) => classifyDnsError(provider, "updateRecord", err),
      }),

    deleteRecord: (zoneId, recordId) =>
      Effect.tryPromise({
        try: () => adapter.deleteRecord(zoneId, recordId),
        catch: (err) => classifyDnsError(provider, "deleteRecord", err),
      }),
  })
}
