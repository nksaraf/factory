import {
  ENCODED_PING,
  buildGoawayFrame,
  decodeFrame,
  encodeFrame,
} from "@smp/factory-shared/tunnel-protocol"

import type { Database } from "../../db/connection"
import { logger as rootLogger } from "../../logger"
import * as gw from "./gateway.service"
import { StreamManager } from "./tunnel-streams"

const logger = rootLogger.child({ module: "tunnel-broker" })

/**
 * In-memory map of active tunnel connections.
 * Maps tunnelId → WebSocket for request forwarding.
 */
const activeTunnels = new Map<string, WebSocket>()
const subdomainToTunnelId = new Map<string, string>()
const tunnelStreams = new Map<string, StreamManager>()

/**
 * Generate a random subdomain for tunnel allocation.
 */
function generateSubdomain(): string {
  const adjectives = [
    "quick",
    "bright",
    "calm",
    "bold",
    "cool",
    "fast",
    "keen",
    "neat",
    "safe",
    "warm",
    "wise",
    "fair",
    "glad",
    "kind",
  ]
  const nouns = [
    "fox",
    "owl",
    "elk",
    "bee",
    "ant",
    "jay",
    "ray",
    "cat",
    "dog",
    "fin",
    "gem",
    "hub",
    "key",
    "oak",
  ]
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  const num = Math.floor(Math.random() * 100)
  return `${adj}-${noun}-${num}`
}

export interface TunnelBrokerOptions {
  db: Database
  heartbeatIntervalMs?: number
}

/** Max frames retained for reconnect replay. ~1000 frames × 65KB ≈ 64MB worst case. */
const REPLAY_BUFFER_CAPACITY = 1024

interface ReplayEntry {
  seq: number
  data: Uint8Array
}

interface TunnelState {
  tunnelId: string | null
  streamManager: StreamManager | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  cleaning: boolean
  /** Monotonically increasing sequence for outgoing binary frames. */
  outSeq: number
  /** Circular buffer of recently sent frames for reconnect replay. */
  replayBuffer: ReplayEntry[]
}

const connectionState = new WeakMap<WebSocket, TunnelState>()

/** Grace period for keeping routes + replay buffers alive after disconnect. */
const RECONNECT_GRACE_MS = 60_000

/**
 * Detached tunnel state keyed by tunnelId.
 * When a tunnel disconnects, its replay buffer and route are kept alive.
 * If the client reconnects within the grace period, the route is reclaimed.
 * Otherwise, the route and tunnel are cleaned up.
 */
interface DetachedTunnel {
  buffer: ReplayEntry[]
  outSeq: number
  subdomain: string
  timer: ReturnType<typeof setTimeout>
}
const detachedTunnels = new Map<string, DetachedTunnel>()

function getOrCreateState(ws: WebSocket): TunnelState {
  let state = connectionState.get(ws)
  if (!state) {
    state = {
      tunnelId: null,
      streamManager: null,
      heartbeatTimer: null,
      cleaning: false,
      outSeq: 0,
      replayBuffer: [],
    }
    connectionState.set(ws, state)
  }
  return state
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
  const { db, heartbeatIntervalMs = 30_000 } = opts

  return {
    open(ws: WebSocket) {
      logger.info("tunnel ws connected")
      getOrCreateState(ws)
    },

    async message(
      ws: WebSocket,
      data: string | Buffer | ArrayBuffer | Uint8Array
    ) {
      const state = getOrCreateState(ws)

      // After registration, handle binary frames
      if (state.tunnelId) {
        let bytes: Uint8Array | null = null
        if (data instanceof ArrayBuffer) {
          bytes = new Uint8Array(data)
        } else if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
          bytes =
            data instanceof Uint8Array ? data : new Uint8Array(data as Buffer)
        }

        if (bytes) {
          try {
            const frame = decodeFrame(bytes)
            state.streamManager?.handleFrame(frame)
          } catch {
            // Malformed frame, ignore
          }
          return
        }
      }

      // Pre-registration: JSON text messages
      // Elysia may auto-parse JSON WebSocket messages into plain objects,
      // or pass raw strings/buffers depending on version.
      try {
        const msg =
          typeof data === "object" &&
          data !== null &&
          !(data instanceof ArrayBuffer) &&
          !(data instanceof Uint8Array) &&
          !Buffer.isBuffer(data)
            ? (data as any)
            : JSON.parse(
                typeof data === "string"
                  ? data
                  : data instanceof ArrayBuffer
                    ? new TextDecoder().decode(data)
                    : data instanceof Uint8Array || Buffer.isBuffer(data)
                      ? new TextDecoder().decode(data)
                      : ""
              )

        if (msg.type === "register" && !state.tunnelId) {
          const subdomain = msg.subdomain || generateSubdomain()
          const routeFamily =
            msg.routeFamily === "dev" ? ("dev" as const) : ("tunnel" as const)
          logger.info(
            {
              subdomain,
              principalId: msg.principalId,
              localAddr: msg.localAddr,
              routeFamily,
            },
            "registering tunnel"
          )

          // Check if we can reclaim a detached tunnel (route kept alive during grace period)
          const resumeTunnelId = msg.resume?.tunnelId
          const detached = resumeTunnelId
            ? detachedTunnels.get(resumeTunnelId)
            : undefined
          let tunnelId: string
          let tunnelSubdomain: string
          let tunnelUrl: string
          let portRoutes: any[] | undefined

          if (detached && detached.subdomain === subdomain) {
            // Reclaim the existing tunnel — route is still alive in DB
            clearTimeout(detached.timer)
            detachedTunnels.delete(resumeTunnelId!)
            tunnelId = resumeTunnelId!
            tunnelSubdomain = detached.subdomain
            const gatewayDomain =
              process.env.DX_GATEWAY_DOMAIN ?? "lepton.software"
            const domainSuffix =
              routeFamily === "dev"
                ? `.dev.${gatewayDomain}`
                : `.tunnel.${gatewayDomain}`
            tunnelUrl = `https://${tunnelSubdomain}${domainSuffix}`
            // Update heartbeat so the DB knows we're alive
            await gw.heartbeatTunnel(db, tunnelId).catch(() => {})
            logger.info(
              { tunnelId, subdomain: tunnelSubdomain },
              "tunnel reclaimed from grace period"
            )
          } else {
            // Clean up stale detached entry if subdomain changed
            if (detached) {
              clearTimeout(detached.timer)
              detachedTunnels.delete(resumeTunnelId!)
              if (detached.subdomain)
                subdomainToTunnelId.delete(detached.subdomain)
              await gw.closeTunnel(db, resumeTunnelId!).catch(() => {})
            }
            // Fresh registration
            const publishPorts = Array.isArray(msg.publishPorts)
              ? (msg.publishPorts as number[]).filter(
                  (p) => typeof p === "number" && p > 0
                )
              : undefined
            const {
              tunnel,
              route,
              portRoutes: registeredPortRoutes,
            } = await gw.registerTunnel(db, {
              subdomain,
              principalId: msg.principalId ?? "anonymous",
              localAddr: msg.localAddr ?? "localhost:3000",
              createdBy: msg.principalId ?? "anonymous",
              routeFamily,
              systemDeploymentId:
                msg.systemDeploymentId ?? msg.deploymentTargetId,
              publishPorts,
            })
            tunnelId = tunnel.tunnelId
            tunnelSubdomain = tunnel.subdomain
            tunnelUrl = `https://${route.domain}`
            portRoutes = registeredPortRoutes
          }

          state.tunnelId = tunnelId
          if (!state.tunnelId)
            throw new Error("tunnel registration returned null ID")
          activeTunnels.set(tunnelId, ws)
          subdomainToTunnelId.set(tunnelSubdomain, tunnelId)

          // Create stream manager — track outgoing sequence for replay
          state.streamManager = new StreamManager((frameData) => {
            state.outSeq++
            if (state.replayBuffer.length >= REPLAY_BUFFER_CAPACITY) {
              state.replayBuffer.shift()
            }
            state.replayBuffer.push({ seq: state.outSeq, data: frameData })
            ws.send(frameData as unknown as ArrayBuffer)
          })
          tunnelStreams.set(tunnelId, state.streamManager)

          logger.info(
            { tunnelId, subdomain: tunnelSubdomain },
            "tunnel registered"
          )
          ws.send(
            JSON.stringify({
              type: "registered",
              tunnelId,
              subdomain: tunnelSubdomain,
              url: tunnelUrl,
              portUrls: portRoutes?.map((r: any) => ({
                port: r.spec?.targetPort,
                url: `https://${r.domain}`,
              })),
            })
          )

          // Replay missed frames AFTER "registered" so the client is ready.
          // Preserve original seq numbers so the client's counter stays in sync
          // with the replay buffer — avoids frame loss on double-reconnect.
          if (detached && typeof msg.resume?.lastReceivedSeq === "number") {
            const replayFrom = msg.resume.lastReceivedSeq
            let replayed = 0
            for (const entry of detached.buffer) {
              if (entry.seq > replayFrom) {
                if (state.replayBuffer.length >= REPLAY_BUFFER_CAPACITY) {
                  state.replayBuffer.shift()
                }
                state.replayBuffer.push({ seq: entry.seq, data: entry.data })
                ws.send(entry.data as unknown as ArrayBuffer)
                replayed++
                // Keep outSeq in sync with the highest replayed seq
                if (entry.seq > state.outSeq) {
                  state.outSeq = entry.seq
                }
              }
            }
            logger.info(
              { tunnelId, replayed, from: replayFrom },
              "tunnel resumed with replay"
            )
          }

          // Start heartbeat with binary PING frames
          state.heartbeatTimer = setInterval(async () => {
            if (state.tunnelId) {
              await gw.heartbeatTunnel(db, state.tunnelId).catch(() => {})
              try {
                ws.send(ENCODED_PING as unknown as ArrayBuffer)
              } catch {
                // WS may be closing
              }
            }
          }, heartbeatIntervalMs)
        }
      } catch (err) {
        logger.error(
          {
            err,
            dataType: typeof data,
            constructorName: data?.constructor?.name,
          },
          "tunnel registration failed"
        )
        ws.send(JSON.stringify({ type: "error", message: "Invalid message" }))
      }
    },

    async close(ws: WebSocket) {
      const state = connectionState.get(ws)
      if (!state || state.cleaning || !state.tunnelId) return
      state.cleaning = true
      const tunnelId = state.tunnelId
      logger.info({ tunnelId }, "tunnel disconnected")

      if (state.heartbeatTimer) clearInterval(state.heartbeatTimer)
      state.streamManager?.cleanup()
      tunnelStreams.delete(tunnelId)
      activeTunnels.delete(tunnelId)

      // Keep route alive during grace period for seamless reconnect.
      // The subdomain→tunnelId mapping stays so getTunnelStreamManager
      // returns undefined (streamManager was deleted) — gateway returns 502
      // only for the brief reconnect window rather than 404 (unknown subdomain).
      const t = await gw.getTunnel(db, tunnelId).catch(() => null)
      const subdomain = t?.subdomain
      const timer = setTimeout(async () => {
        detachedTunnels.delete(tunnelId)
        if (subdomain && subdomainToTunnelId.get(subdomain) === tunnelId) {
          subdomainToTunnelId.delete(subdomain)
        }
        await gw.closeTunnel(db, tunnelId).catch(() => {})
        logger.info(
          { tunnelId, subdomain },
          "tunnel grace period expired, route cleaned up"
        )
      }, RECONNECT_GRACE_MS)

      detachedTunnels.set(tunnelId, {
        buffer: state.replayBuffer,
        outSeq: state.outSeq,
        subdomain: subdomain ?? "",
        timer,
      })

      state.tunnelId = null
    },
  }
}

// Keep the old API for backward compatibility (used in tests)
export async function handleTunnelConnection(
  ws: WebSocket,
  opts: TunnelBrokerOptions
): Promise<void> {
  const handlers = createTunnelHandlers(opts)
  handlers.open(ws)

  ws.addEventListener("message", async (event) => {
    await handlers.message(ws, event.data)
  })

  ws.addEventListener("close", async () => {
    await handlers.close(ws)
  })

  ws.addEventListener("error", async () => {
    await handlers.close(ws)
  })
}

/**
 * Look up the WebSocket for a given subdomain.
 * Used by the gateway proxy to forward requests.
 */
export function getTunnelSocket(subdomain: string): WebSocket | undefined {
  const tunnelId = subdomainToTunnelId.get(subdomain)
  if (!tunnelId) return undefined
  return activeTunnels.get(tunnelId)
}

/**
 * Look up the StreamManager for a given subdomain.
 * Used by the gateway proxy to send HTTP requests through the tunnel.
 */
export function getTunnelStreamManager(
  subdomain: string
): StreamManager | undefined {
  const tunnelId = subdomainToTunnelId.get(subdomain)
  if (!tunnelId) return undefined
  return tunnelStreams.get(tunnelId)
}

/**
 * Get count of active tunnel connections.
 */
export function getActiveTunnelCount(): number {
  return activeTunnels.size
}

/**
 * Graceful drain: send GOAWAY to all connected tunnels.
 * Tunnels should finish in-flight requests then reconnect to another broker.
 */
export function drainAllTunnels(): void {
  const goaway = encodeFrame(buildGoawayFrame())
  for (const [, ws] of activeTunnels) {
    try {
      ws.send(goaway as unknown as ArrayBuffer)
    } catch {
      // WS may already be closing
    }
  }
  // Cancel grace period timers for detached tunnels
  for (const [, detached] of detachedTunnels) {
    clearTimeout(detached.timer)
  }
  detachedTunnels.clear()
}
