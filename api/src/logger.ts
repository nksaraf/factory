import pino from "pino";

const level = process.env.FACTORY_LOG_LEVEL ?? "info";
const format = process.env.FACTORY_LOG_FORMAT ?? "json";

const redactPaths = [
  "password",
  "*.password",
  "secret",
  "*.secret",
  "token",
  "*.token",
  "headers.authorization",
  "headers.cookie",
];

export const logger = pino({
  level,
  ...(format === "pretty"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
  redact: { paths: redactPaths, censor: "[REDACTED]" },
  base: { service: "factory-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

export default function plugin(app: any) {
  app.hooks.hook("request", (request: any) => {
    request._requestId = crypto.randomUUID();
    request._startTime = performance.now();
    logger.info(
      {
        requestId: request._requestId,
        method: request.method,
        path: request.path,
      },
      "request started"
    );
  });

  app.hooks.hook("afterResponse", (event: any, { body }: any) => {
    const durationMs = Math.round(performance.now() - (event._startTime ?? 0));
    logger.info(
      {
        requestId: event._requestId,
        path: event.path,
        statusCode: body?.status,
        durationMs,
      },
      "request completed"
    );
  });
}
