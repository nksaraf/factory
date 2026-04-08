import { WebClient, LogLevel } from "@slack/web-api";

// Force Node's HTTP adapter instead of Bun's fetch adapter.
// Bun's fetch drops keep-alive sockets causing "socket connection was
// closed unexpectedly" errors on every identity sync cycle.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpAdapter = require("axios/unsafe/adapters/http.js");

const clients = new Map<string, WebClient>();

export function slackClient(token: string): WebClient {
  let client = clients.get(token);
  if (!client) {
    client = new WebClient(token, {
      logLevel: LogLevel.WARN,
      timeout: 30_000,
      adapter: httpAdapter,
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
