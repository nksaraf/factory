import { trace, context, propagation } from "@opentelemetry/api"

const enabled = process.env.TELEMETRY_ENABLED === "true"

let _shutdownFn: (() => Promise<void>) | undefined

if (enabled) {
  const { BasicTracerProvider, BatchSpanProcessor } = await import(
    "@opentelemetry/sdk-trace-base"
  )
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-http"
  )
  const { W3CTraceContextPropagator } = await import("@opentelemetry/core")
  const { resourceFromAttributes } = await import("@opentelemetry/resources")
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318"

  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "dx-cli",
      "service.version": "0.0.2",
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
      ),
    ],
  })

  trace.setGlobalTracerProvider(provider)
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())

  _shutdownFn = async () => {
    await provider.forceFlush()
    await provider.shutdown()
  }
}

export const tracer = trace.getTracer("dx-cli")

/**
 * Bun's AsyncLocalStorage doesn't wire up with OTel's startActiveSpan,
 * so we track the current span explicitly.
 */
let _currentSpan: ReturnType<typeof tracer.startSpan> | undefined

/** Start a span and set it as the current span for trace propagation. */
export function startSpan(name: string) {
  const span = tracer.startSpan(name)
  _currentSpan = span
  return span
}

/** Inject W3C trace context headers for outgoing requests. */
export function getTraceHeaders(): Record<string, string> {
  if (!enabled) return {}
  const span = _currentSpan ?? trace.getActiveSpan()
  if (!span) return {}
  const ctx = trace.setSpan(context.active(), span)
  const headers: Record<string, string> = {}
  propagation.inject(ctx, headers)
  return headers
}

/** Flush pending spans — call before process.exit. */
export async function shutdownTelemetry() {
  await _shutdownFn?.()
}
