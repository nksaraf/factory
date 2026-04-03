import { logger } from "@smp/factory-api/logger"

export default function plugin(app: any) {
  app.hooks.hook("request", (request: any) => {
    request._requestId = crypto.randomUUID()
    request._startTime = performance.now()
    logger.info(
      {
        requestId: request._requestId,
        method: request.method,
        path: request.path,
      },
      "request started"
    )
  })

  app.hooks.hook("afterResponse", (event: any, { body }: any) => {
    const durationMs = Math.round(performance.now() - (event._startTime ?? 0))
    logger.info(
      {
        requestId: event._requestId,
        path: event.path,
        statusCode: body?.status,
        durationMs,
      },
      "request completed"
    )
  })
}
