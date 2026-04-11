const enabled = process.env.TELEMETRY_ENABLED === "true"

if (enabled) {
  const { NodeSDK } = await import("@opentelemetry/sdk-node")
  const { getNodeAutoInstrumentations } =
    await import("@opentelemetry/auto-instrumentations-node")
  const { OTLPTraceExporter } =
    await import("@opentelemetry/exporter-trace-otlp-http")
  const { OTLPMetricExporter } =
    await import("@opentelemetry/exporter-metrics-otlp-http")
  const { PeriodicExportingMetricReader } =
    await import("@opentelemetry/sdk-metrics")
  const { resourceFromAttributes } = await import("@opentelemetry/resources")

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318"

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": "factory-api",
      "service.version": "0.0.1",
      "deployment.environment": process.env.NODE_ENV || "development",
      "telemetry.sdk.runtime": "bun",
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
      }),
      exportIntervalMillis: 60000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
  })

  sdk.start()

  process.on("SIGTERM", async () => {
    await sdk.shutdown()
  })

  console.log("[otel] Telemetry enabled — exporting to", endpoint)
}
