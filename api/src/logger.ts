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

