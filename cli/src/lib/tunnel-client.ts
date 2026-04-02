import { readConfig, resolveFactoryUrl } from "../config.js";
import { getStoredBearerToken } from "../session-token.js";
import {
  decodeFrame,
  encodeFrame,
  buildHttpResFrame,
  buildDataFrame,
  buildRstStreamFrame,
  buildWsDataFrame,
  buildWsCloseFrame,
  ENCODED_PONG,
  parseJsonPayload,
  FrameType,
  Flags,
  MAX_PAYLOAD_SIZE,
  type HttpRequestPayload,
  type WsUpgradePayload,
} from "@smp/factory-shared/tunnel-protocol";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);

/** High-water mark for backpressure on WebSocket sends (1MB). */
const SEND_HIGH_WATER = 1024 * 1024;

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

export interface ReconnectConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  maxAttempts: number;
}

const DEFAULT_RECONNECT: ReconnectConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterFactor: 0.3,
  maxAttempts: Infinity,
};

/**
 * Opens a WebSocket tunnel to the factory broker with auto-reconnect.
 *
 * Protocol:
 *  1. Connect to ws(s)://<api>/api/v1/factory/infra/gateway/tunnels/ws
 *  2. Send JSON: { type: "register", localAddr, subdomain?, principalId }
 *  3. Receive JSON: { type: "registered", tunnelId, subdomain, url }
 *  4. After registration, handle binary frames:
 *     - HTTP_REQ → forward to localhost:port → send HTTP_RES + DATA back
 *     - WS_UPGRADE → open local WS, bridge messages via WS_DATA
 *     - PING → respond with PONG
 *     - GOAWAY → prepare for reconnect
 */
export async function openTunnel(
  opts: TunnelClientOptions,
  callbacks: {
    onRegistered: (info: TunnelInfo) => void;
    onError: (err: Error) => void;
    onClose: () => void;
    onReconnecting?: (attempt: number, delayMs: number) => void;
  },
  reconnectConfig?: Partial<ReconnectConfig>
): Promise<{ close: () => void }> {
  const config = await readConfig();
  const base = resolveFactoryUrl(config);
  const wsUrl = base.replace(/^http/, "ws") + "/api/v1/factory/infra/gateway/tunnels/ws";
  const rc = { ...DEFAULT_RECONNECT, ...reconnectConfig };

  let intentionalClose = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentWs: WebSocket | null = null;
  // Track forwarded WebSocket connections per streamId
  let activeLocalWs = new Map<number, WebSocket>();

  function cleanupLocalWebSockets() {
    for (const [, localWs] of activeLocalWs) {
      try { localWs.close(); } catch {}
    }
    activeLocalWs.clear();
  }

  function connect() {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    currentWs = ws;
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
      if (registered && event.data instanceof ArrayBuffer) {
        handleBinaryFrame(new Uint8Array(event.data), ws, opts.port, activeLocalWs);
        return;
      }

      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : "");
        if (msg.type === "registered" && !registered) {
          registered = true;
          reconnectAttempt = 0; // Reset on successful registration
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
      cleanupLocalWebSockets();
      if (intentionalClose) {
        callbacks.onClose();
        return;
      }
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // error fires before close, just notify
      callbacks.onError(new Error("WebSocket error"));
    });
  }

  function scheduleReconnect() {
    if (intentionalClose) return;
    if (reconnectAttempt >= rc.maxAttempts) {
      callbacks.onClose();
      return;
    }

    const delay = Math.min(
      rc.baseDelayMs * Math.pow(2, reconnectAttempt),
      rc.maxDelayMs
    ) * (1 + Math.random() * rc.jitterFactor);

    reconnectAttempt++;
    callbacks.onReconnecting?.(reconnectAttempt, Math.round(delay));

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  // Initial connection
  connect();

  return {
    close() {
      intentionalClose = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanupLocalWebSockets();
      currentWs?.close();
    },
  };
}

/**
 * Handle an incoming binary frame from the broker.
 */
export function handleBinaryFrame(
  data: Uint8Array,
  ws: WebSocket,
  localPort: number,
  activeLocalWs?: Map<number, WebSocket>
): void {
  let frame;
  try {
    frame = decodeFrame(data);
  } catch {
    return; // malformed frame
  }

  switch (frame.type) {
    case FrameType.PING: {
      ws.send(ENCODED_PONG);
      break;
    }

    case FrameType.HTTP_REQ: {
      forwardToLocal(frame.streamId, frame, ws, localPort);
      break;
    }

    case FrameType.WS_UPGRADE: {
      forwardWsUpgrade(frame.streamId, frame, ws, localPort, activeLocalWs);
      break;
    }

    case FrameType.WS_DATA: {
      // Forward data to the local WebSocket for this stream
      const localWs = activeLocalWs?.get(frame.streamId);
      if (localWs && localWs.readyState === WebSocket.OPEN) {
        if (frame.flags & Flags.BINARY) {
          localWs.send(frame.payload);
        } else {
          localWs.send(new TextDecoder().decode(frame.payload));
        }
      }
      break;
    }

    case FrameType.WS_CLOSE: {
      const localWs = activeLocalWs?.get(frame.streamId);
      if (localWs) {
        localWs.close();
        activeLocalWs?.delete(frame.streamId);
      }
      break;
    }

    case FrameType.GOAWAY: {
      // Server is shutting down — close will fire and trigger reconnect
      break;
    }
  }
}

/**
 * Forward a WS_UPGRADE frame: open a local WebSocket and bridge messages.
 */
function forwardWsUpgrade(
  streamId: number,
  frame: { payload: Uint8Array },
  tunnelWs: WebSocket,
  localPort: number,
  activeLocalWs?: Map<number, WebSocket>
): void {
  let upgrade: WsUpgradePayload;
  try {
    upgrade = parseJsonPayload<WsUpgradePayload>(frame as any);
  } catch {
    tunnelWs.send(encodeFrame(buildRstStreamFrame(streamId)));
    return;
  }

  try {
    const localWs = new WebSocket(`ws://localhost:${localPort}${upgrade.url}`);
    localWs.binaryType = "arraybuffer";
    activeLocalWs?.set(streamId, localWs);

    localWs.addEventListener("message", (event) => {
      try {
        if (event.data instanceof ArrayBuffer) {
          tunnelWs.send(encodeFrame(buildWsDataFrame(streamId, new Uint8Array(event.data), true)));
        } else {
          tunnelWs.send(encodeFrame(buildWsDataFrame(streamId, new TextEncoder().encode(event.data as string), false)));
        }
      } catch {
        // tunnel WS may be closing
      }
    });

    localWs.addEventListener("close", () => {
      activeLocalWs?.delete(streamId);
      try {
        tunnelWs.send(encodeFrame(buildWsCloseFrame(streamId)));
      } catch {}
    });

    localWs.addEventListener("error", () => {
      activeLocalWs?.delete(streamId);
      try {
        tunnelWs.send(encodeFrame(buildRstStreamFrame(streamId)));
      } catch {}
    });
  } catch {
    tunnelWs.send(encodeFrame(buildRstStreamFrame(streamId)));
  }
}

/**
 * Forward an HTTP_REQ frame to localhost and stream the response back.
 */
async function forwardToLocal(
  streamId: number,
  frame: { payload: Uint8Array },
  ws: WebSocket,
  localPort: number
): Promise<void> {
  let req: HttpRequestPayload;
  try {
    req = parseJsonPayload<HttpRequestPayload>(frame as any);
  } catch {
    ws.send(encodeFrame(buildRstStreamFrame(streamId)));
    return;
  }

  try {
    const url = `http://localhost:${localPort}${req.url}`;
    const localRes = await fetch(url, {
      method: req.method,
      headers: req.headers,
      redirect: "manual",
    });

    // Send HTTP_RES frame with status + headers (strip hop-by-hop headers)
    const resHeaders: Record<string, string> = {};
    localRes.headers.forEach((val, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        resHeaders[key] = val;
      }
    });
    ws.send(
      encodeFrame(
        buildHttpResFrame(streamId, {
          status: localRes.status,
          headers: resHeaders,
        })
      )
    );

    // Stream body as DATA frames with backpressure
    if (localRes.body) {
      const reader = localRes.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            ws.send(encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true)));
            break;
          }
          let offset = 0;
          while (offset < value.byteLength) {
            // Backpressure: wait if WS buffer is full
            while (ws.bufferedAmount > SEND_HIGH_WATER) {
              await new Promise(r => setTimeout(r, 5));
            }
            const end = Math.min(offset + MAX_PAYLOAD_SIZE, value.byteLength);
            const chunk = value.subarray(offset, end);
            ws.send(encodeFrame(buildDataFrame(streamId, chunk, false)));
            offset = end;
          }
        }
      } catch {
        ws.send(encodeFrame(buildRstStreamFrame(streamId)));
        return;
      }
    } else {
      ws.send(encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true)));
    }
  } catch {
    // Local server unreachable
    ws.send(encodeFrame(buildRstStreamFrame(streamId)));
  }
}
