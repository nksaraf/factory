import { propagation } from "@opentelemetry/api"

const enabled = process.env.TELEMETRY_ENABLED === "true"

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
      "service.name": "factory-api",
      "service.version": "0.0.1",
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
      ),
    ],
  })

  propagation.setGlobalTextMapPropagator(new W3CTraceContextPropagator())
  provider.register()

  process.on("SIGTERM", async () => {
    await provider.forceFlush()
    await provider.shutdown()
  })

  console.log("[otel] Telemetry enabled — exporting to", endpoint)
}
