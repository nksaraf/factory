import { WebClient, LogLevel } from "@slack/web-api";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { URL } from "node:url";

/**
 * Custom axios adapter that uses Node's http/https modules directly,
 * bypassing Bun's fetch which drops keep-alive sockets causing
 * "socket connection was closed unexpectedly" errors.
 */
function nodeHttpAdapter(config: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(config.url, config.baseURL);
    const isHttps = url.protocol === "https:";
    const reqFn = isHttps ? httpsRequest : httpRequest;

    const headers: Record<string, string> = {};
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        if (value != null && typeof value !== "function" && typeof value !== "object") {
          headers[key] = String(value);
        }
      }
    }

    const req = reqFn(
      url,
      {
        method: (config.method ?? "GET").toUpperCase(),
        headers,
        timeout: config.timeout ?? 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          let data: any = body;
          try { data = JSON.parse(body); } catch {}
          resolve({
            data,
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers,
            config,
            request: req,
          });
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    if (config.data) {
      const body = typeof config.data === "string" ? config.data : JSON.stringify(config.data);
      req.write(body);
    }
    req.end();
  });
}

const clients = new Map<string, WebClient>();

export function slackClient(token: string): WebClient {
  let client = clients.get(token);
  if (!client) {
    client = new WebClient(token, {
      logLevel: LogLevel.WARN,
      timeout: 30_000,
      adapter: nodeHttpAdapter,
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
