/**
 * Trace service — request-aware network graph traversal.
 *
 * Composes with DnsResolver for start-point resolution:
 * - If `start` is provided, traces from that entity directly.
 * - If omitted + `request.domain` exists, DnsResolver finds the DNS entity.
 *
 * The pure graph-walk algorithm stays in modules/infra/trace.ts.
 * This service handles start-point resolution and error classification.
 */

import { Context, Data, Effect } from "effect"
import type {
  RequestContext,
  RequestGraphReader,
  TraceNode,
} from "../../modules/infra/trace"
import {
  parseRequestInput,
  traceRequest as traceRequestPure,
} from "../../modules/infra/trace"
import type { DnsResolver } from "./dns-resolver"

// ── Types ──────────────────────────────────────────────────

export interface TraceResult {
  readonly request: RequestContext
  readonly root: TraceNode
}

// ── Errors ─────────────────────────────────────────────────

export class TraceError extends Data.TaggedError("TraceError")<{
  readonly phase: "dns-lookup" | "graph-walk" | "no-start"
  readonly message: string
}> {}

export class TraceStartNotFoundError extends Data.TaggedError(
  "TraceStartNotFoundError"
)<{
  readonly hostname: string
  readonly message: string
}> {}

// ── Service ────────────────────────────────────────────────

export class Trace extends Context.Tag("Trace")<
  Trace,
  {
    readonly trace: (
      request: RequestContext,
      start?: { kind: string; id: string }
    ) => Effect.Effect<TraceResult, TraceError | TraceStartNotFoundError>
  }
>() {}

// ── Re-export for callers ──────────────────────────────────

export { parseRequestInput }

// ── Implementation ─────────────────────────────────────────

export function makeTrace(
  reader: RequestGraphReader,
  dns: typeof DnsResolver.Service
): typeof Trace.Service {
  return {
    trace: (request, start) =>
      Effect.gen(function* () {
        let startKind: string
        let startId: string

        if (start) {
          startKind = start.kind
          startId = start.id
        } else if (request.domain) {
          const entity = yield* Effect.mapError(
            dns.findEntity(request.domain),
            () =>
              new TraceError({
                phase: "dns-lookup",
                message: `DNS lookup failed for: ${request.domain}`,
              })
          )

          if (!entity) {
            return yield* new TraceStartNotFoundError({
              hostname: request.domain,
              message: `No DNS domain found for: ${request.domain}`,
            })
          }

          startKind = "dns-domain"
          startId = entity.id
        } else {
          return yield* new TraceError({
            phase: "no-start",
            message: "No start point: provide start or a domain in the request",
          })
        }

        const root = yield* Effect.tryPromise({
          try: () => traceRequestPure(reader, request, startKind, startId),
          catch: (err) =>
            new TraceError({
              phase: "graph-walk",
              message: `Trace failed: ${err instanceof Error ? err.message : String(err)}`,
            }),
        })

        return { request, root }
      }),
  }
}
