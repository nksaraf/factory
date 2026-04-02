import type { Database } from "../../db/connection";
import { logger as rootLogger } from "../../logger";
import * as gw from "./gateway.service";
import { StreamManager } from "./tunnel-streams";
import {
  decodeFrame,
  encodeFrame,
  ENCODED_PING,
  FrameType,
  buildGoawayFrame,
} from "@smp/factory-shared/tunnel-protocol";

const logger = rootLogger.child({ module: "tunnel-broker" });

/**
 * In-memory map of active tunnel connections.
 * Maps tunnelId → WebSocket for request forwarding.
 */
const activeTunnels = new Map<string, WebSocket>();
const subdomainToTunnelId = new Map<string, string>();
const tunnelStreams = new Map<string, StreamManager>();

/**
 * Generate a random subdomain for tunnel allocation.
 */
function generateSubdomain(): string {
  const adjectives = [
    "quick", "bright", "calm", "bold", "cool", "fast", "keen",
    "neat", "safe", "warm", "wise", "fair", "glad", "kind",
  ];
  const nouns = [
    "fox", "owl", "elk", "bee", "ant", "jay", "ray",
    "cat", "dog", "fin", "gem", "hub", "key", "oak",
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}-${noun}-${num}`;
}

export interface TunnelBrokerOptions {
  db: Database;
  heartbeatIntervalMs?: number;
}

interface TunnelState {
  tunnelId: string | null;
  streamManager: StreamManager | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  cleaning: boolean;
}

const connectionState = new WeakMap<WebSocket, TunnelState>();

function getOrCreateState(ws: WebSocket): TunnelState {
  let state = connectionState.get(ws);
  if (!state) {
    state = { tunnelId: null, streamManager: null, heartbeatTimer: null, cleaning: false };
    connectionState.set(ws, state);
  }
  return state;
}

/**
 * Create Elysia-compatible WebSocket handlers for tunnel connections.
 *
 * Protocol:
 * 1. Client sends JSON: { type: "register", localAddr, subdomain?, principalId }
 * 2. Server responds JSON: { type: "registered", tunnelId, subdomain, url }
 * 3. After registration, all messages are binary frames (tunnel-protocol)
 * 4. Server sends periodic PING frames; client responds with PONG
 * 5. On close, server removes tunnel + route
 */
export function createTunnelHandlers(opts: TunnelBrokerOptions) {
  const { db, heartbeatIntervalMs = 30_000 } = opts;

  return {
    open(ws: WebSocket) {
      logger.info("tunnel ws connected");
      getOrCreateState(ws);
    },

    async message(ws: WebSocket, data: string | Buffer | ArrayBuffer | Uint8Array) {
      const state = getOrCreateState(ws);

      // After registration, handle binary frames
      if (state.tunnelId) {
        let bytes: Uint8Array | null = null;
        if (data instanceof ArrayBuffer) {
          bytes = new Uint8Array(data);
        } else if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
          bytes = data instanceof Uint8Array ? data : new Uint8Array(data as Buffer);
        }

        if (bytes) {
          try {
            const frame = decodeFrame(bytes);
            state.streamManager?.handleFrame(frame);
          } catch {
            // Malformed frame, ignore
          }
          return;
        }
      }

      // Pre-registration: JSON text messages
      try {
        const msg = JSON.parse(typeof data === "string" ? data : "");

        if (msg.type === "register" && !state.tunnelId) {
          const subdomain = msg.subdomain || generateSubdomain();
          const routeFamily = msg.routeFamily === "sandbox" ? "sandbox" as const : "tunnel" as const;
          logger.info({ subdomain, principalId: msg.principalId, localAddr: msg.localAddr, routeFamily }, "registering tunnel");
          const { tunnel, route } = await gw.registerTunnel(db, {
            subdomain,
            principalId: msg.principalId ?? "anonymous",
            localAddr: msg.localAddr ?? "localhost:3000",
            createdBy: msg.principalId ?? "anonymous",
            routeFamily,
            deploymentTargetId: msg.deploymentTargetId,
          });

          state.tunnelId = tunnel.tunnelId;
          if (!state.tunnelId) throw new Error("tunnel registration returned null ID");
          activeTunnels.set(state.tunnelId, ws);
          subdomainToTunnelId.set(subdomain, state.tunnelId);

          // Create stream manager for this tunnel
          state.streamManager = new StreamManager((frameData) => {
            ws.send(frameData);
          });
          tunnelStreams.set(state.tunnelId, state.streamManager);

          logger.info({ tunnelId: tunnel.tunnelId, subdomain: tunnel.subdomain, domain: route.domain }, "tunnel registered");
          ws.send(
            JSON.stringify({
              type: "registered",
              tunnelId: tunnel.tunnelId,
              subdomain: tunnel.subdomain,
              url: `https://${route.domain}`,
            })
          );

          // Start heartbeat with binary PING frames
          state.heartbeatTimer = setInterval(async () => {
            if (state.tunnelId) {
              await gw.heartbeatTunnel(db, state.tunnelId).catch(() => {});
              try {
                ws.send(ENCODED_PING);
              } catch {
                // WS may be closing
              }
            }
          }, heartbeatIntervalMs);
        }
      } catch (err) {
        logger.error({ err }, "tunnel registration failed");
        ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
      }
    },

    async close(ws: WebSocket) {
      const state = connectionState.get(ws);
      if (!state || state.cleaning || !state.tunnelId) return;
      state.cleaning = true;
      logger.info({ tunnelId: state.tunnelId }, "tunnel disconnected");

      if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
      state.streamManager?.cleanup();
      tunnelStreams.delete(state.tunnelId);

      const t = await gw.getTunnel(db, state.tunnelId).catch(() => null);
      if (t) {
        subdomainToTunnelId.delete(t.subdomain);
      }
      activeTunnels.delete(state.tunnelId);
      await gw.closeTunnel(db, state.tunnelId).catch(() => {});
      state.tunnelId = null;
    },
  };
}

// Keep the old API for backward compatibility (used in tests)
export async function handleTunnelConnection(
  ws: WebSocket,
  opts: TunnelBrokerOptions
): Promise<void> {
  const handlers = createTunnelHandlers(opts);
  handlers.open(ws);

  ws.addEventListener("message", async (event) => {
    await handlers.message(ws, event.data);
  });

  ws.addEventListener("close", async () => {
    await handlers.close(ws);
  });

  ws.addEventListener("error", async () => {
    await handlers.close(ws);
  });
}

/**
 * Look up the WebSocket for a given subdomain.
 * Used by the gateway proxy to forward requests.
 */
export function getTunnelSocket(subdomain: string): WebSocket | undefined {
  const tunnelId = subdomainToTunnelId.get(subdomain);
  if (!tunnelId) return undefined;
  return activeTunnels.get(tunnelId);
}

/**
 * Look up the StreamManager for a given subdomain.
 * Used by the gateway proxy to send HTTP requests through the tunnel.
 */
export function getTunnelStreamManager(
  subdomain: string
): StreamManager | undefined {
  const tunnelId = subdomainToTunnelId.get(subdomain);
  if (!tunnelId) return undefined;
  return tunnelStreams.get(tunnelId);
}

/**
 * Get count of active tunnel connections.
 */
export function getActiveTunnelCount(): number {
  return activeTunnels.size;
}

/**
 * Graceful drain: send GOAWAY to all connected tunnels.
 * Tunnels should finish in-flight requests then reconnect to another broker.
 */
export function drainAllTunnels(): void {
  const goaway = encodeFrame(buildGoawayFrame());
  for (const [, ws] of activeTunnels) {
    try {
      ws.send(goaway);
    } catch {
      // WS may already be closing
    }
  }
}
