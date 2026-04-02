import { type Context } from "@opentelemetry/api"
import { getWebAutoInstrumentations } from "@opentelemetry/auto-instrumentations-web"
import { ZoneContextManager } from "@opentelemetry/context-zone"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { registerInstrumentations } from "@opentelemetry/instrumentation"
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources"
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web"

import { rio } from "@rio.js/client"
import type { RioClient } from "@rio.js/os"

if (import.meta.env.PUBLIC_TELEMETRY_ENABLED === "true") {
  const resource = defaultResource().merge(
    resourceFromAttributes({
      "service.name": "factory-ui",
      "service.version": "0.1.0",
    }),
  )

  const traceUrl =
    import.meta.env.PUBLIC_OTEL_ENDPOINT || "http://localhost:4318/v1/traces"
  const exporter = new OTLPTraceExporter({ url: traceUrl })
  const processor = new BatchSpanProcessor(exporter)

  class UserSpanProcessor implements SpanProcessor {
    constructor(private rio: RioClient) {}
    onStart(span: Span, parentContext: Context): void {
      if (this.rio.auth?.me) {
        span.setAttribute("user.id", this.rio.auth.me?.id)
        span.setAttribute("user.email", this.rio.auth.me?.email)
      }
    }
    async forceFlush(): Promise<void> {}
    onEnd(span: ReadableSpan): void {}
    async shutdown(): Promise<void> {}
  }

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [processor, new UserSpanProcessor(rio)],
  })

  provider.register({
    contextManager: new ZoneContextManager(),
  })

  registerInstrumentations({
    instrumentations: [
      getWebAutoInstrumentations({
        "@opentelemetry/instrumentation-xml-http-request": {
          propagateTraceHeaderCorsUrls: [/.+/g],
        },
        "@opentelemetry/instrumentation-fetch": {
          propagateTraceHeaderCorsUrls: [/.+/g],
          ignoreUrls: [/iconify/g],
        },
      }),
    ],
  })
}
