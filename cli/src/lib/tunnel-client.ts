import {
  ENCODED_PONG,
  Flags,
  type Frame,
  FrameType,
  type HttpRequestPayload,
  MAX_PAYLOAD_SIZE,
  type WsUpgradePayload,
  buildDataFrame,
  buildDataFrames,
  buildHttpResFrame,
  buildRstStreamFrame,
  buildWsCloseFrame,
  buildWsDataFrame,
  decodeFrame,
  encodeFrame,
  parseJsonPayload,
} from "@smp/factory-shared/tunnel-protocol"

import { getFactoryApiToken } from "../client.js"
import { readConfig, resolveFactoryUrl } from "../config.js"
import { getAuthServiceToken } from "../session-token.js"

/** Send Uint8Array via WebSocket — passes the underlying ArrayBuffer to work around TS 5.7+ ArrayBufferLike variance. */
const buf = (data: Uint8Array): ArrayBuffer =>
  data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

/** High-water mark for backpressure on WebSocket sends (1MB). */
const SEND_HIGH_WATER = 1024 * 1024

export interface TunnelClientOptions {
  port: number
  subdomain?: string
  principalId?: string
  routeFamily?: "dev" | "tunnel"
  publishPorts?: number[]
}

export interface TunnelInfo {
  tunnelId: string
  subdomain: string
  url: string
  portUrls?: { port: number; url: string }[]
}

export interface ReconnectConfig {
  baseDelayMs: number
  maxDelayMs: number
  jitterFactor: number
  maxAttempts: number
}

const DEFAULT_RECONNECT: ReconnectConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterFactor: 0.3,
  maxAttempts: Infinity,
}

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
    onRegistered: (info: TunnelInfo) => void
    onError: (err: Error) => void
    onClose: () => void
    onReconnecting?: (attempt: number, delayMs: number) => void
    onReconnected?: (info: TunnelInfo) => void
  },
  reconnectConfig?: Partial<ReconnectConfig>
): Promise<{ close: () => void }> {
  const config = await readConfig()
  const base = resolveFactoryUrl(config)
  // WS clients can't send Authorization headers — pass JWT as query param
  const jwt = await getFactoryApiToken()
  const tokenParam = jwt ? `?token=${encodeURIComponent(jwt)}` : ""
  const wsUrl =
    base.replace(/^http/, "ws") +
    "/api/v1/factory/infra/tunnel-broker" +
    tokenParam
  const rc = { ...DEFAULT_RECONNECT, ...reconnectConfig }

  let intentionalClose = false
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let currentWs: WebSocket | null = null
  let hasRegisteredOnce = false
  let lastTunnelId: string | null = null
  /** Sequence counter for incoming binary frames — used for reconnect resume. */
  let lastReceivedSeq = 0
  // Track forwarded WebSocket connections per streamId
  let activeLocalWs = new Map<number, WebSocket>()
  // Track pending request body streams per streamId
  let pendingBodies: PendingBodies = new Map()
  // Track WS_DATA messages received before local WS is open (per connection)
  let wsQueues: WsConnectQueues = new Map()

  function cleanupLocalWebSockets() {
    for (const [, localWs] of activeLocalWs) {
      try {
        localWs.close()
      } catch {}
    }
    activeLocalWs.clear()
    wsQueues.clear()
    // Close any pending body streams
    for (const [, sink] of pendingBodies) {
      try {
        sink.controller.error(new Error("tunnel disconnected"))
      } catch {}
    }
    pendingBodies.clear()
  }

  function connect() {
    const ws = new WebSocket(wsUrl)
    ws.binaryType = "arraybuffer"
    currentWs = ws
    let registered = false

    ws.addEventListener("open", async () => {
      const token = await getAuthServiceToken()
      const msg: Record<string, unknown> = {
        type: "register",
        localAddr: `localhost:${opts.port}`,
        subdomain: opts.subdomain,
        principalId: opts.principalId ?? token ?? "anonymous",
        routeFamily: opts.routeFamily,
        publishPorts: opts.publishPorts,
      }
      // Include resume info on reconnect
      if (lastTunnelId && lastReceivedSeq > 0) {
        msg.resume = { tunnelId: lastTunnelId, lastReceivedSeq }
      }
      ws.send(JSON.stringify(msg))
    })

    ws.addEventListener("message", (event) => {
      if (registered && event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data)
        // Increment seq for non-PING frames (PINGs are sent directly by broker,
        // not through StreamManager, so they're not in the replay buffer)
        if (bytes.length >= 2 && bytes[1] !== FrameType.PING) {
          lastReceivedSeq++
        }
        handleBinaryFrame(
          bytes,
          ws,
          opts.port,
          activeLocalWs,
          pendingBodies,
          wsQueues
        )
        return
      }

      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : "")
        if (msg.type === "registered" && !registered) {
          registered = true
          const wasReconnect = hasRegisteredOnce
          hasRegisteredOnce = true
          lastTunnelId = msg.tunnelId
          reconnectAttempt = 0 // Reset on successful registration
          const info: TunnelInfo = {
            tunnelId: msg.tunnelId,
            subdomain: msg.subdomain,
            url: msg.url,
            portUrls: msg.portUrls,
          }
          if (wasReconnect) {
            callbacks.onReconnected?.(info)
          }
          callbacks.onRegistered(info)
        } else if (msg.type === "error") {
          callbacks.onError(new Error(msg.message ?? "Tunnel error"))
        }
      } catch {
        // ignore parse errors
      }
    })

    ws.addEventListener("close", () => {
      cleanupLocalWebSockets()
      if (intentionalClose) {
        callbacks.onClose()
        return
      }
      scheduleReconnect()
    })

    ws.addEventListener("error", () => {
      // error fires before close, just notify
      callbacks.onError(new Error("WebSocket error"))
    })
  }

  function scheduleReconnect() {
    if (intentionalClose) return
    if (reconnectAttempt >= rc.maxAttempts) {
      callbacks.onClose()
      return
    }

    const delay =
      Math.min(rc.baseDelayMs * Math.pow(2, reconnectAttempt), rc.maxDelayMs) *
      (1 + Math.random() * rc.jitterFactor)

    reconnectAttempt++
    callbacks.onReconnecting?.(reconnectAttempt, Math.round(delay))

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  // Initial connection
  connect()

  return {
    close() {
      intentionalClose = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      cleanupLocalWebSockets()
      currentWs?.close()
    },
  }
}

/** High-water mark for request body buffering per stream (4MB). */
const BODY_HIGH_WATER = 4 * 1024 * 1024

/**
 * Tracks pending request body streams with backpressure.
 * When an HTTP_REQ arrives for a method with a body (POST/PUT/PATCH),
 * we create a ReadableStream and stash the body sink here.
 * Subsequent DATA frames for that streamId push data into the buffer.
 * If the total enqueued data exceeds BODY_HIGH_WATER, excess data is held
 * in the overflow buffer until the consumer pulls.
 */
export interface BodySink {
  controller: ReadableStreamDefaultController<Uint8Array>
  /** Overflow buffer: chunks that exceeded the high-water mark. */
  buffer: Uint8Array[]
  /** Bytes held in the overflow buffer (not counting directly-enqueued data). */
  bufferedBytes: number
  /** Total bytes enqueued to the controller (used for high-water check). */
  enqueuedBytes: number
  finished: boolean
}

export type PendingBodies = Map<number, BodySink>

/** Per-stream queue for WS_DATA messages received before the local WS is open. */
export type WsConnectQueues = Map<
  number,
  { data: Uint8Array; isBinary: boolean }[]
>

/**
 * Handle an incoming binary frame from the broker.
 */
export function handleBinaryFrame(
  data: Uint8Array,
  ws: WebSocket,
  localPort: number,
  activeLocalWs?: Map<number, WebSocket>,
  pendingBodies?: PendingBodies,
  wsConnectQueues?: WsConnectQueues
): void {
  let frame
  try {
    frame = decodeFrame(data)
  } catch {
    return // malformed frame
  }

  switch (frame.type) {
    case FrameType.PING: {
      ws.send(buf(ENCODED_PONG))
      break
    }

    case FrameType.HTTP_REQ: {
      forwardToLocal(frame.streamId, frame, ws, localPort, pendingBodies)
      break
    }

    case FrameType.DATA: {
      // Request body DATA frame — push to the body sink with backpressure
      const sink = pendingBodies?.get(frame.streamId)
      if (sink) {
        try {
          if (frame.payload.byteLength > 0) {
            if (sink.enqueuedBytes < BODY_HIGH_WATER) {
              // Under high-water: enqueue directly to the stream
              sink.controller.enqueue(frame.payload)
              sink.enqueuedBytes += frame.payload.byteLength
            } else {
              // Over high-water: overflow to buffer until consumer pulls
              sink.buffer.push(frame.payload)
              sink.bufferedBytes += frame.payload.byteLength
            }
          }
          if (frame.flags & Flags.FIN) {
            sink.finished = true
            // If no buffered data, close immediately
            if (sink.buffer.length === 0) {
              sink.controller.close()
              pendingBodies?.delete(frame.streamId)
            }
            // Otherwise pull() will close after draining
          }
        } catch {
          pendingBodies?.delete(frame.streamId)
        }
      }
      break
    }

    case FrameType.WS_UPGRADE: {
      forwardWsUpgrade(
        frame.streamId,
        frame,
        ws,
        localPort,
        activeLocalWs,
        wsConnectQueues
      )
      break
    }

    case FrameType.WS_DATA: {
      // Forward data to the local WebSocket for this stream
      const localWs = activeLocalWs?.get(frame.streamId)
      if (!localWs) break
      const isBinary = !!(frame.flags & Flags.BINARY)
      if (localWs.readyState === WebSocket.OPEN) {
        if (isBinary) {
          localWs.send(buf(frame.payload))
        } else {
          localWs.send(new TextDecoder().decode(frame.payload))
        }
      } else if (localWs.readyState === WebSocket.CONNECTING) {
        // Queue until the local WS opens
        const queue = wsConnectQueues?.get(frame.streamId)
        queue?.push({ data: frame.payload, isBinary })
      }
      break
    }

    case FrameType.WS_CLOSE: {
      const localWs = activeLocalWs?.get(frame.streamId)
      if (localWs) {
        localWs.close()
        activeLocalWs?.delete(frame.streamId)
      }
      break
    }

    case FrameType.GOAWAY: {
      // Server is shutting down — close will fire and trigger reconnect
      break
    }
  }
}

/**
 * Get the queue for a stream (used by tests to inspect queued messages).
 */
export function getWsConnectQueue(streamId: number, queues?: WsConnectQueues) {
  return queues?.get(streamId)
}

/**
 * Forward a WS_UPGRADE frame: open a local WebSocket and bridge messages.
 */
function forwardWsUpgrade(
  streamId: number,
  frame: Frame,
  tunnelWs: WebSocket,
  localPort: number,
  activeLocalWs?: Map<number, WebSocket>,
  wsConnectQueues?: WsConnectQueues
): void {
  let upgrade: WsUpgradePayload
  try {
    upgrade = parseJsonPayload<WsUpgradePayload>(frame)
  } catch {
    tunnelWs.send(buf(encodeFrame(buildRstStreamFrame(streamId))))
    return
  }

  try {
    const targetPort =
      parseInt(upgrade.headers?.["x-dx-target-port"] ?? "", 10) || localPort
    if (upgrade.headers) delete upgrade.headers["x-dx-target-port"]
    const localWs = new WebSocket(`ws://localhost:${targetPort}${upgrade.url}`)
    localWs.binaryType = "arraybuffer"
    activeLocalWs?.set(streamId, localWs)

    // Create a queue for messages received while the WS is still connecting
    const queue: { data: Uint8Array; isBinary: boolean }[] = []
    wsConnectQueues?.set(streamId, queue)

    localWs.addEventListener("open", () => {
      // Drain queued messages
      for (const msg of queue) {
        if (msg.isBinary) {
          localWs.send(buf(msg.data))
        } else {
          localWs.send(new TextDecoder().decode(msg.data))
        }
      }
      wsConnectQueues?.delete(streamId)
    })

    localWs.addEventListener("message", (event) => {
      try {
        if (event.data instanceof ArrayBuffer) {
          tunnelWs.send(
            buf(
              encodeFrame(
                buildWsDataFrame(streamId, new Uint8Array(event.data), true)
              )
            )
          )
        } else {
          tunnelWs.send(
            buf(
              encodeFrame(
                buildWsDataFrame(
                  streamId,
                  new TextEncoder().encode(event.data as string),
                  false
                )
              )
            )
          )
        }
      } catch {
        // tunnel WS may be closing
      }
    })

    let errorFired = false

    localWs.addEventListener("close", () => {
      activeLocalWs?.delete(streamId)
      wsConnectQueues?.delete(streamId)
      // Don't send WS_CLOSE if error already sent RST_STREAM
      if (!errorFired) {
        try {
          tunnelWs.send(buf(encodeFrame(buildWsCloseFrame(streamId))))
        } catch {}
      }
    })

    localWs.addEventListener("error", () => {
      errorFired = true
      activeLocalWs?.delete(streamId)
      wsConnectQueues?.delete(streamId)
      try {
        tunnelWs.send(buf(encodeFrame(buildRstStreamFrame(streamId))))
      } catch {}
    })
  } catch {
    wsConnectQueues?.delete(streamId)
    try {
      tunnelWs.send(buf(encodeFrame(buildRstStreamFrame(streamId))))
    } catch {}
  }
}

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"])

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
  let req: HttpRequestPayload
  try {
    req = parseJsonPayload<HttpRequestPayload>(frame)
  } catch {
    ws.send(buf(encodeFrame(buildRstStreamFrame(streamId))))
    return
  }

  try {
    const targetPort =
      parseInt(req.headers["x-dx-target-port"] ?? "", 10) || localPort
    delete req.headers["x-dx-target-port"]
    const url = `http://localhost:${targetPort}${req.url}`

    // Build request body for methods that support it
    let body: ReadableStream<Uint8Array> | undefined
    if (METHODS_WITH_BODY.has(req.method.toUpperCase()) && pendingBodies) {
      const sink: BodySink = {
        controller: null!,
        buffer: [],
        bufferedBytes: 0,
        enqueuedBytes: 0,
        finished: false,
      }
      body = new ReadableStream<Uint8Array>({
        start(controller) {
          sink.controller = controller
          pendingBodies.set(streamId, sink)
        },
        pull() {
          // Drain overflow buffer when the consumer is ready
          while (sink.buffer.length > 0) {
            const chunk = sink.buffer.shift()!
            sink.bufferedBytes -= chunk.byteLength
            sink.controller.enqueue(chunk)
          }
          // Reset enqueued counter so new DATA frames go direct again
          sink.enqueuedBytes = 0
          if (sink.finished) {
            sink.controller.close()
            pendingBodies.delete(streamId)
          }
        },
        cancel() {
          pendingBodies.delete(streamId)
        },
      })
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
    })

    // Send HTTP_RES frame with status + headers (strip hop-by-hop only)
    const resHeaders: Record<string, string> = {}
    localRes.headers.forEach((val, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        resHeaders[key] = val
      }
    })
    ws.send(
      buf(
        encodeFrame(
          buildHttpResFrame(streamId, {
            status: localRes.status,
            headers: resHeaders,
          })
        )
      )
    )

    // Stream body as DATA frames with backpressure
    if (localRes.body) {
      const reader = localRes.body.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) {
            ws.send(
              buf(
                encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true))
              )
            )
            break
          }
          let offset = 0
          while (offset < value.byteLength) {
            // Backpressure: wait if WS buffer is full
            while (ws.bufferedAmount > SEND_HIGH_WATER) {
              await new Promise((r) => setTimeout(r, 5))
            }
            const end = Math.min(offset + MAX_PAYLOAD_SIZE, value.byteLength)
            const chunk = value.subarray(offset, end)
            ws.send(buf(encodeFrame(buildDataFrame(streamId, chunk, false))))
            offset = end
          }
        }
      } catch {
        ws.send(buf(encodeFrame(buildRstStreamFrame(streamId))))
        return
      }
    } else {
      ws.send(
        buf(encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true)))
      )
    }
  } catch {
    // Local server unreachable — clean up pending body sink
    const sink = pendingBodies?.get(streamId)
    if (sink) {
      try {
        sink.controller.error(new Error("fetch failed"))
      } catch {}
      pendingBodies?.delete(streamId)
    }
    ws.send(buf(encodeFrame(buildRstStreamFrame(streamId))))
  }
}
