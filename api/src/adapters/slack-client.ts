import { WebClient, LogLevel } from "@slack/web-api";
import { Agent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

/**
 * Shared Slack WebClient factory — reuses clients per token with:
 * - Node HTTP agent (bypasses Bun's fetch keep-alive socket issues)
 * - 30s timeout
 * - 3 retries with exponential backoff
 */

const clients = new Map<string, WebClient>();

const agent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 5,
  timeout: 30_000,
});

export function slackClient(token: string): WebClient {
  let client = clients.get(token);
  if (!client) {
    client = new WebClient(token, {
      logLevel: LogLevel.WARN,
      timeout: 30_000,
      agent,
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
