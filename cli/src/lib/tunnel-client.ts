import { readConfig, resolveFactoryUrl } from "../config.js";
import { getStoredBearerToken } from "../session-token.js";
import {
  decodeFrame,
  encodeFrame,
  buildHttpResFrame,
  buildDataFrame,
  buildDataFrames,
  buildRstStreamFrame,
  buildWsDataFrame,
  buildWsCloseFrame,
  ENCODED_PONG,
  parseJsonPayload,
  FrameType,
  Flags,
  MAX_PAYLOAD_SIZE,
  type Frame,
  type HttpRequestPayload,
  type WsUpgradePayload,
} from "@smp/factory-shared/tunnel-protocol";

/** Send Uint8Array via WebSocket — passes the underlying ArrayBuffer to work around TS 5.7+ ArrayBufferLike variance. */
const buf = (data: Uint8Array): ArrayBuffer => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

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
 *  1. Connect to ws(s)://<api>/api/v1/factory/infra/tunnel-broker
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
  const wsUrl = base.replace(/^http/, "ws") + "/api/v1/factory/infra/tunnel-broker";
  const rc = { ...DEFAULT_RECONNECT, ...reconnectConfig };

  let intentionalClose = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentWs: WebSocket | null = null;
  // Track forwarded WebSocket connections per streamId
  let activeLocalWs = new Map<number, WebSocket>();
  // Track pending request body streams per streamId
  let pendingBodies: PendingBodies = new Map();

  function cleanupLocalWebSockets() {
    for (const [, localWs] of activeLocalWs) {
      try { localWs.close(); } catch {}
    }
    activeLocalWs.clear();
    // Close any pending body streams
    for (const [, controller] of pendingBodies) {
      try { controller.error(new Error("tunnel disconnected")); } catch {}
    }
    pendingBodies.clear();
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
        handleBinaryFrame(new Uint8Array(event.data), ws, opts.port, activeLocalWs, pendingBodies);
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
 * Tracks pending request body streams.
 * When an HTTP_REQ arrives for a method with a body (POST/PUT/PATCH),
 * we create a ReadableStream and stash the controller here.
 * Subsequent DATA frames for that streamId push data into the stream.
 */
export type PendingBodies = Map<number, ReadableStreamDefaultController<Uint8Array>>;

/**
 * Handle an incoming binary frame from the broker.
 */
export function handleBinaryFrame(
  data: Uint8Array,
  ws: WebSocket,
  localPort: number,
  activeLocalWs?: Map<number, WebSocket>,
  pendingBodies?: PendingBodies
): void {
  let frame;
  try {
    frame = decodeFrame(data);
  } catch {
    return; // malformed frame
  }

  switch (frame.type) {
    case FrameType.PING: {
      ws.send(buf(ENCODED_PONG));
      break;
    }

    case FrameType.HTTP_REQ: {
      forwardToLocal(frame.streamId, frame, ws, localPort, pendingBodies);
      break;
    }

    case FrameType.DATA: {
      // Request body DATA frame — push to the pending body stream
      const controller = pendingBodies?.get(frame.streamId);
      if (controller) {
        try {
          if (frame.payload.byteLength > 0) {
            controller.enqueue(frame.payload);
          }
          if (frame.flags & Flags.FIN) {
            controller.close();
            pendingBodies?.delete(frame.streamId);
          }
        } catch {
          pendingBodies?.delete(frame.streamId);
        }
      }
      break;
    }

    case FrameType.WS_UPGRADE: {
      forwardWsUpgrade(frame.streamId, frame, ws, localPort, activeLocalWs);
      break;
    }

    case FrameType.WS_DATA: {
      // Forward data to the local WebSocket for this stream
      const localWs = activeLocalWs?.get(frame.streamId);
      if (!localWs) break;
      const isBinary = !!(frame.flags & Flags.BINARY);
      if (localWs.readyState === WebSocket.OPEN) {
        if (isBinary) {
          localWs.send(buf(frame.payload));
        } else {
          localWs.send(new TextDecoder().decode(frame.payload));
        }
      } else if (localWs.readyState === WebSocket.CONNECTING) {
        // Queue until the local WS opens
        const queue = wsConnectQueues.get(frame.streamId);
        queue?.push({ data: frame.payload, isBinary });
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
 * Per-stream queue for WS_DATA messages received before the local WS is open.
 * Without this, messages arriving during the CONNECTING state are lost.
 */
const wsConnectQueues = new Map<number, { data: Uint8Array; isBinary: boolean }[]>();

/**
 * Get the queue for a stream (used by handleBinaryFrame for WS_DATA).
 */
export function getWsConnectQueue(streamId: number) {
  return wsConnectQueues.get(streamId);
}

/**
 * Forward a WS_UPGRADE frame: open a local WebSocket and bridge messages.
 */
function forwardWsUpgrade(
  streamId: number,
  frame: Frame,
  tunnelWs: WebSocket,
  localPort: number,
  activeLocalWs?: Map<number, WebSocket>
): void {
  let upgrade: WsUpgradePayload;
  try {
    upgrade = parseJsonPayload<WsUpgradePayload>(frame);
  } catch {
    tunnelWs.send(buf(encodeFrame(buildRstStreamFrame(streamId))));
    return;
  }

  try {
    const localWs = new WebSocket(`ws://localhost:${localPort}${upgrade.url}`);
    localWs.binaryType = "arraybuffer";
    activeLocalWs?.set(streamId, localWs);

    // Create a queue for messages received while the WS is still connecting
    const queue: { data: Uint8Array; isBinary: boolean }[] = [];
    wsConnectQueues.set(streamId, queue);

    localWs.addEventListener("open", () => {
      // Drain queued messages
      for (const msg of queue) {
        if (msg.isBinary) {
          localWs.send(buf(msg.data));
        } else {
          localWs.send(new TextDecoder().decode(msg.data));
        }
      }
      wsConnectQueues.delete(streamId);
    });

    localWs.addEventListener("message", (event) => {
      try {
        if (event.data instanceof ArrayBuffer) {
          tunnelWs.send(buf(encodeFrame(buildWsDataFrame(streamId, new Uint8Array(event.data), true))));
        } else {
          tunnelWs.send(buf(encodeFrame(buildWsDataFrame(streamId, new TextEncoder().encode(event.data as string), false))));
        }
      } catch {
        // tunnel WS may be closing
      }
    });

    localWs.addEventListener("close", () => {
      activeLocalWs?.delete(streamId);
      wsConnectQueues.delete(streamId);
      try {
        tunnelWs.send(buf(encodeFrame(buildWsCloseFrame(streamId))));
      } catch {}
    });

    localWs.addEventListener("error", () => {
      activeLocalWs?.delete(streamId);
      wsConnectQueues.delete(streamId);
      try {
        tunnelWs.send(buf(encodeFrame(buildRstStreamFrame(streamId))));
      } catch {}
    });
  } catch {
    tunnelWs.send(buf(encodeFrame(buildRstStreamFrame(streamId))));
  }
}

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Forward an HTTP_REQ frame to localhost and stream the response back.
 *
 * For methods that can have a body (POST/PUT/PATCH/DELETE), we create a
 * ReadableStream and register the controller in `pendingBodies`. Subsequent
 * DATA frames for this streamId will push data into the stream. The fetch
 * to localhost starts immediately with the stream as body (true streaming).
 */
async function forwardToLocal(
  streamId: number,
  frame: Frame,
  ws: WebSocket,
  localPort: number,
  pendingBodies?: PendingBodies
): Promise<void> {
  let req: HttpRequestPayload;
  try {
    req = parseJsonPayload<HttpRequestPayload>(frame);
  } catch {
    ws.send(buf(encodeFrame(buildRstStreamFrame(streamId))));
    return;
  }

  try {
    const url = `http://localhost:${localPort}${req.url}`;

    // Build request body for methods that support it
    let body: ReadableStream<Uint8Array> | undefined;
    if (METHODS_WITH_BODY.has(req.method.toUpperCase()) && pendingBodies) {
      body = new ReadableStream<Uint8Array>({
        start(controller) {
          pendingBodies.set(streamId, controller);
        },
        cancel() {
          pendingBodies.delete(streamId);
        },
      });
    }

    const localRes = await fetch(url, {
      method: req.method,
      headers: req.headers,
      body,
      redirect: "manual",
      // @ts-expect-error Bun supports duplex streaming
      duplex: body ? "half" : undefined,
      // Bun-specific: disable auto-decompression so we
      // pass the original compressed bytes through the tunnel unchanged.
      // This preserves Content-Encoding and saves bandwidth over the WS.
      decompress: false,
    });

    // Send HTTP_RES frame with status + headers (strip hop-by-hop only)
    const resHeaders: Record<string, string> = {};
    localRes.headers.forEach((val, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        resHeaders[key] = val;
      }
    });
    ws.send(
      buf(encodeFrame(
        buildHttpResFrame(streamId, {
          status: localRes.status,
          headers: resHeaders,
        })
      ))
    );

    // Stream body as DATA frames with backpressure
    if (localRes.body) {
      const reader = localRes.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            ws.send(buf(encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true))));
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
            ws.send(buf(encodeFrame(buildDataFrame(streamId, chunk, false))));
            offset = end;
          }
        }
      } catch {
        ws.send(buf(encodeFrame(buildRstStreamFrame(streamId))));
        return;
      }
    } else {
      ws.send(buf(encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true))));
    }
  } catch {
    // Local server unreachable
    ws.send(buf(encodeFrame(buildRstStreamFrame(streamId))));
  }
}
