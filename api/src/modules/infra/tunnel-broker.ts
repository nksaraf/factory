import type { Database } from "../../db/connection";
import * as gw from "./gateway.service";
import { StreamManager } from "./tunnel-streams";
import {
  decodeFrame,
  encodeFrame,
  buildPingFrame,
  FrameType,
} from "@smp/factory-shared/tunnel-protocol";

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

/**
 * Handle a new tunnel WebSocket connection.
 *
 * Protocol:
 * 1. Client sends JSON: { type: "register", localAddr, subdomain?, principalId }
 * 2. Server responds JSON: { type: "registered", tunnelId, subdomain, url }
 * 3. After registration, all messages are binary frames (tunnel-protocol)
 * 4. Server sends periodic PING frames; client responds with PONG
 * 5. On close/error, server removes tunnel + route
 */
export async function handleTunnelConnection(
  ws: WebSocket,
  opts: TunnelBrokerOptions
): Promise<void> {
  const { db, heartbeatIntervalMs = 30_000 } = opts;
  let tunnelId: string | null = null;
  let streamManager: StreamManager | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  ws.addEventListener("message", async (event) => {
    // After registration, handle binary frames
    if (tunnelId && event.data instanceof ArrayBuffer) {
      try {
        const frame = decodeFrame(new Uint8Array(event.data));
        streamManager?.handleFrame(frame);
      } catch {
        // Malformed frame, ignore
      }
      return;
    }

    // Also handle Uint8Array / Buffer for Bun compatibility
    if (tunnelId && event.data instanceof Uint8Array) {
      try {
        const frame = decodeFrame(event.data);
        streamManager?.handleFrame(frame);
      } catch {
        // Malformed frame, ignore
      }
      return;
    }

    // Pre-registration: JSON text messages
    try {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : "");

      if (msg.type === "register" && !tunnelId) {
        const subdomain = msg.subdomain || generateSubdomain();
        const { tunnel, route } = await gw.registerTunnel(db, {
          subdomain,
          principalId: msg.principalId ?? "anonymous",
          localAddr: msg.localAddr ?? "localhost:3000",
          createdBy: msg.principalId ?? "anonymous",
        });

        tunnelId = tunnel.tunnelId;
        activeTunnels.set(tunnelId!, ws);
        subdomainToTunnelId.set(subdomain, tunnelId!);

        // Create stream manager for this tunnel
        streamManager = new StreamManager((data) => {
          ws.send(data);
        });
        tunnelStreams.set(tunnelId!, streamManager);

        ws.send(
          JSON.stringify({
            type: "registered",
            tunnelId: tunnel.tunnelId,
            subdomain: tunnel.subdomain,
            url: `https://${route.domain}`,
          })
        );

        // Start heartbeat with binary PING frames
        heartbeatTimer = setInterval(async () => {
          if (tunnelId) {
            await gw.heartbeatTunnel(db, tunnelId).catch(() => {});
            try {
              ws.send(encodeFrame(buildPingFrame()));
            } catch {
              // WS may be closing
            }
          }
        }, heartbeatIntervalMs);
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
    }
  });

  ws.addEventListener("close", async () => {
    await cleanup();
  });

  ws.addEventListener("error", async () => {
    await cleanup();
  });

  async function cleanup() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (tunnelId) {
      streamManager?.cleanup();
      tunnelStreams.delete(tunnelId);
      const t = await gw.getTunnel(db, tunnelId).catch(() => null);
      if (t) {
        subdomainToTunnelId.delete(t.subdomain);
      }
      activeTunnels.delete(tunnelId);
      await gw.closeTunnel(db, tunnelId).catch(() => {});
      tunnelId = null;
    }
  }
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
