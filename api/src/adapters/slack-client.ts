import { WebClient, LogLevel } from "@slack/web-api";

/**
 * Shared Slack WebClient factory — reuses clients per token to avoid
 * socket churn that causes "socket connection was closed unexpectedly"
 * errors under Bun's fetch implementation.
 */

const clients = new Map<string, WebClient>();

export function slackClient(token: string): WebClient {
  let client = clients.get(token);
  if (!client) {
    client = new WebClient(token, {
      logLevel: LogLevel.WARN,
      retryConfig: {
        retries: 2,
        factor: 2,
        randomize: true,
      },
    });
    clients.set(token, client);
  }
  return client;
}
