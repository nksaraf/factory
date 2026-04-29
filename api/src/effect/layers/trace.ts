/**
 * Trace live layer — composes DnsResolver + Db into the Trace service.
 *
 * Constructs a drizzleRequestGraphReader from the Db and delegates
 * to the pure traceRequest algorithm for graph walks.
 */

import { Effect, Layer } from "effect"
import { Db } from "./database"
import { Trace, makeTrace } from "../services/trace"
import { DnsResolver } from "../services/dns-resolver"
import { drizzleRequestGraphReader } from "../../modules/infra/trace"

export const TraceLive = Layer.effect(
  Trace,
  Effect.gen(function* () {
    const db = yield* Db
    const dns = yield* DnsResolver
    const reader = drizzleRequestGraphReader(db)
    return makeTrace(reader, dns)
  })
)
