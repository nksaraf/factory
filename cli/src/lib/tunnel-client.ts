import { loadConfig } from "../config.js";
import { getStoredBearerToken } from "../session-token.js";

export interface TunnelClientOptions {
  port: number;
  subdomain?: string;
  principalId?: string;
}

export interface TunnelInfo {
  tunnelId: string;
  subdomain: string;
  url: string;
}

/**
 * Opens a WebSocket tunnel to the factory broker.
 *
 * Protocol:
 *  1. Connect to ws(s)://<api>/api/v1/gateway/tunnels/ws
 *  2. Send { type: "register", localAddr, subdomain?, principalId }
 *  3. Receive { type: "registered", tunnelId, subdomain, url }
 *  4. Keep alive until close
 */
export function openTunnel(
  opts: TunnelClientOptions,
  callbacks: {
    onRegistered: (info: TunnelInfo) => void;
    onError: (err: Error) => void;
    onClose: () => void;
  }
): { close: () => void } {
  const cfg = loadConfig();
  const base = cfg.apiUrl.replace(/\/$/, "");
  const wsUrl = base.replace(/^http/, "ws") + "/api/v1/gateway/tunnels/ws";

  const ws = new WebSocket(wsUrl);
  let registered = false;

  ws.addEventListener("open", async () => {
    const token = await getStoredBearerToken();
    ws.send(
      JSON.stringify({
        type: "register",
        localAddr: `localhost:${opts.port}`,
        subdomain: opts.subdomain,
        principalId: opts.principalId ?? token ?? "anonymous",
      })
    );
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : "");
      if (msg.type === "registered" && !registered) {
        registered = true;
        callbacks.onRegistered({
          tunnelId: msg.tunnelId,
          subdomain: msg.subdomain,
          url: msg.url,
        });
      } else if (msg.type === "error") {
        callbacks.onError(new Error(msg.message ?? "Tunnel error"));
      }
    } catch {
      // ignore parse errors
    }
  });

  ws.addEventListener("close", () => {
    callbacks.onClose();
  });

  ws.addEventListener("error", (event) => {
    callbacks.onError(new Error("WebSocket error"));
  });

  return {
    close() {
      ws.close();
    },
  };
}
