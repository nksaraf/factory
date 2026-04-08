import { WebClient, LogLevel } from "@slack/web-api";
import { logger } from "../logger";

const log = logger.child({ module: "slack-client" });

const clients = new Map<string, WebClient>();

export function slackClient(token: string): WebClient {
  let client = clients.get(token);
  if (!client) {
    client = new WebClient(token, {
      logLevel: LogLevel.WARN,
      timeout: 30_000,
      retryConfig: {
        retries: 3,
        factor: 2,
        randomize: true,
      },
    });
    clients.set(token, client);
  }
  return client;
}

/**
 * Retry wrapper for Slack API calls that fail with Bun socket errors.
 * Bun's fetch drops keep-alive connections causing transient failures.
 */
export async function withSocketRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isSocketError = msg.includes("socket connection was closed unexpectedly");
      if (isSocketError && attempt < maxRetries) {
        const delay = 1000 * (attempt + 1);
        log.warn({ attempt: attempt + 1, maxRetries, label }, `slack socket error, retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}
