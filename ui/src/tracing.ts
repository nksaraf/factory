import { Context } from "@opentelemetry/api"
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
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web"

import { rio } from "@rio.js/client"
import { RioClient } from "@rio.js/os"

// Define resource and service attributes
const resource = defaultResource().merge(
  resourceFromAttributes({
    "service.name": "smart-market-dev",
    "service.version": "0.1.0",
  }),
)

// Set up the OTLP trace exporter
const exporter = new OTLPTraceExporter({
  url: "https://otel.rio.software/v1/traces",
})

// Set up the span processor
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

// Create and configure the WebTracerProvider
const provider = new WebTracerProvider({
  resource: resource,
  spanProcessors: [processor, new UserSpanProcessor(rio)], // Add the span processor here
})

// Register the tracer provider with the context manager
provider.register({
  contextManager: new ZoneContextManager(),
})

// Set up automatic instrumentation for web APIs
registerInstrumentations({
  instrumentations: [
    getWebAutoInstrumentations({
      "@opentelemetry/instrumentation-xml-http-request": {
        propagateTraceHeaderCorsUrls: [
          /.+/g, // Regex to match your backend URLs
        ],
      },
      "@opentelemetry/instrumentation-fetch": {
        propagateTraceHeaderCorsUrls: [
          /.+/g, // Regex to match your backend URLs
        ],
        ignoreUrls: [/iconify/g],
      },
    }),
  ],
})
