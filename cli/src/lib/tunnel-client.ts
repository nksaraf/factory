import { readConfig, resolveFactoryUrl } from "../config.js";
import { getStoredBearerToken } from "../session-token.js";
import {
  decodeFrame,
  encodeFrame,
  buildHttpResFrame,
  buildDataFrames,
  buildPongFrame,
  buildRstStreamFrame,
  parseJsonPayload,
  FrameType,
  type HttpRequestPayload,
} from "@smp/factory-shared/tunnel-protocol";

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
 *  1. Connect to ws(s)://<api>/api/v1/factory/infra/gateway/tunnels/ws
 *  2. Send JSON: { type: "register", localAddr, subdomain?, principalId }
 *  3. Receive JSON: { type: "registered", tunnelId, subdomain, url }
 *  4. After registration, handle binary frames:
 *     - HTTP_REQ → forward to localhost:port → send HTTP_RES + DATA back
 *     - PING → respond with PONG
 */
export async function openTunnel(
  opts: TunnelClientOptions,
  callbacks: {
    onRegistered: (info: TunnelInfo) => void;
    onError: (err: Error) => void;
    onClose: () => void;
  }
): Promise<{ close: () => void }> {
  const config = await readConfig();
  const base = resolveFactoryUrl(config);
  const wsUrl = base.replace(/^http/, "ws") + "/api/v1/factory/infra/gateway/tunnels/ws";

  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
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
    // After registration, handle binary frames
    if (registered && event.data instanceof ArrayBuffer) {
      handleBinaryFrame(new Uint8Array(event.data), ws, opts.port);
      return;
    }

    // Pre-registration: JSON text messages
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

  ws.addEventListener("error", () => {
    callbacks.onError(new Error("WebSocket error"));
  });

  return {
    close() {
      ws.close();
    },
  };
}

/**
 * Handle an incoming binary frame from the broker.
 */
export function handleBinaryFrame(
  data: Uint8Array,
  ws: WebSocket,
  localPort: number
): void {
  let frame;
  try {
    frame = decodeFrame(data);
  } catch {
    return; // malformed frame
  }

  switch (frame.type) {
    case FrameType.PING: {
      ws.send(encodeFrame(buildPongFrame()));
      break;
    }

    case FrameType.HTTP_REQ: {
      // Forward HTTP request to localhost
      forwardToLocal(frame.streamId, frame, ws, localPort);
      break;
    }
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
    const HOP_BY_HOP = new Set([
      "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
      "te", "trailer", "transfer-encoding", "upgrade",
    ]);

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

    // Send body as DATA frame(s) with FIN, chunking at MAX_PAYLOAD_SIZE
    const body = localRes.body ? new Uint8Array(await localRes.arrayBuffer()) : new Uint8Array(0);
    const dataFrames = buildDataFrames(streamId, body);
    for (const df of dataFrames) {
      ws.send(encodeFrame(df));
    }
  } catch {
    // Local server unreachable
    ws.send(encodeFrame(buildRstStreamFrame(streamId)));
  }
}
