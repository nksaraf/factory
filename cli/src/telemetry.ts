import { trace, context, propagation, SpanStatusCode } from "@opentelemetry/api"

const enabled = process.env.TELEMETRY_ENABLED === "true"

let _shutdownFn: (() => Promise<void>) | undefined

if (enabled) {
  const { BasicTracerProvider, BatchSpanProcessor } = await import(
    "@opentelemetry/sdk-trace-base"
  )
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-http"
  )
  const { resourceFromAttributes } = await import("@opentelemetry/resources")
  const { W3CTraceContextPropagator } = await import("@opentelemetry/core")

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

  propagation.setGlobalTextMapPropagator(new W3CTraceContextPropagator())
  provider.register()

  _shutdownFn = async () => {
    await provider.forceFlush()
    await provider.shutdown()
  }
}

export const tracer = trace.getTracer("dx-cli")

/** Inject W3C trace context headers for outgoing requests. */
export function getTraceHeaders(): Record<string, string> {
  if (!enabled) return {}
  const headers: Record<string, string> = {}
  propagation.inject(context.active(), headers)
  return headers
}

/** Flush pending spans — call before process.exit. */
export async function shutdownTelemetry() {
  await _shutdownFn?.()
}
