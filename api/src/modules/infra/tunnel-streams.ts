import {
  Flags,
  type Frame,
  FrameType,
  type HttpRequestPayload,
  type HttpResponsePayload,
  MAX_PAYLOAD_SIZE,
  type WsUpgradePayload,
  buildDataFrame,
  buildDataFrames,
  buildHttpReqFrame,
  buildRstStreamFrame,
  buildWsCloseFrame,
  buildWsDataFrame,
  buildWsUpgradeFrame,
  encodeFrame,
  parseJsonPayload,
} from "@smp/factory-shared/tunnel-protocol"

export interface TunnelResponse {
  status: number
  headers: Record<string, string>
  body: ReadableStream<Uint8Array>
}

interface PendingStream {
  resolve: (res: TunnelResponse) => void
  reject: (err: Error) => void
  responseMeta: HttpResponsePayload | null
  bodyController: ReadableStreamDefaultController<Uint8Array> | null
  resolved: boolean
  timer: ReturnType<typeof setTimeout> | null
  /** Timer for body DATA inactivity — resets on each DATA frame. */
  bodyTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Manages multiplexed streams over a single tunnel WebSocket.
 *
 * Server-initiated streams use even IDs (2, 4, 6, ...).
 * Each stream corresponds to one HTTP request/response pair.
 */
export type WsMessageHandler = (
  streamId: number,
  data: Uint8Array,
  isBinary: boolean
) => void
export type WsCloseHandler = (streamId: number) => void

interface WsStreamHandlers {
  onMessage: WsMessageHandler
  onClose: WsCloseHandler
}

export class StreamManager {
  private nextId = 2 // even IDs for server-initiated
  private pending = new Map<number, PendingStream>()
  private sendFn: (data: Uint8Array) => void
  private maxConcurrentStreams: number
  private bodyTimeoutMs: number

  /** Per-stream WebSocket handlers, keyed by streamId. */
  private wsHandlers = new Map<number, WsStreamHandlers>()

  /** Active body readers from streamBody(), cancelled on cleanup(). */
  private activeReaders = new Set<ReadableStreamDefaultReader<Uint8Array>>()

  constructor(
    send: (data: Uint8Array) => void,
    opts?: { maxConcurrentStreams?: number; bodyTimeoutMs?: number }
  ) {
    this.sendFn = send
    this.maxConcurrentStreams = opts?.maxConcurrentStreams ?? 256
    this.bodyTimeoutMs = opts?.bodyTimeoutMs ?? 30_000
  }

  /** Register per-stream handlers for WS_DATA and WS_CLOSE frames. */
  registerWsStream(streamId: number, handlers: WsStreamHandlers): void {
    this.wsHandlers.set(streamId, handlers)
  }

  /** Unregister handlers for a WebSocket stream. */
  unregisterWsStream(streamId: number): void {
    this.wsHandlers.delete(streamId)
  }

  nextStreamId(): number {
    // Skip IDs that are in-flight (pending HTTP streams or active WS streams)
    while (this.pending.has(this.nextId) || this.wsHandlers.has(this.nextId)) {
      this.nextId += 2
      if (this.nextId > 0xfffffffe) {
        this.nextId = 2
      }
    }
    const id = this.nextId
    this.nextId += 2
    if (this.nextId > 0xfffffffe) {
      this.nextId = 2
    }
    return id
  }

  /**
   * Send an HTTP request through the tunnel and await the response.
   * Body can be a Uint8Array (buffered) or ReadableStream (streamed).
   */
  sendHttpRequest(
    req: HttpRequestPayload,
    opts?: {
      body?: ReadableStream<Uint8Array> | Uint8Array
      timeoutMs?: number
    }
  ): Promise<TunnelResponse> {
    if (this.pending.size >= this.maxConcurrentStreams) {
      return Promise.reject(new Error("Too many concurrent streams"))
    }

    const streamId = this.nextStreamId()
    const timeoutMs = opts?.timeoutMs ?? 30_000

    return new Promise<TunnelResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const stream = this.pending.get(streamId)
        this.pending.delete(streamId)
        if (stream?.resolved && stream.bodyController) {
          try {
            stream.bodyController.error(
              new Error(`Stream ${streamId} timed out after ${timeoutMs}ms`)
            )
          } catch {}
        } else {
          reject(new Error(`Stream ${streamId} timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      this.pending.set(streamId, {
        resolve,
        reject,
        responseMeta: null,
        bodyController: null,
        resolved: false,
        timer,
        bodyTimer: null,
      })

      // Send HTTP_REQ frame
      const reqFrame = buildHttpReqFrame(streamId, req)
      this.sendFn(encodeFrame(reqFrame))

      // Send body if present, or an empty FIN to signal no body
      if (opts?.body) {
        if (opts.body instanceof ReadableStream) {
          this.streamBody(streamId, opts.body)
        } else if (opts.body.byteLength > 0) {
          const dataFrames = buildDataFrames(streamId, opts.body)
          for (const df of dataFrames) {
            this.sendFn(encodeFrame(df))
          }
        } else {
          // Empty Uint8Array body — send FIN immediately
          this.sendFn(
            encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true))
          )
        }
      } else {
        // No body at all — send empty FIN so client's ReadableStream closes
        this.sendFn(
          encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true))
        )
      }
    })
  }

  private startBodyTimer(streamId: number, stream: PendingStream): void {
    if (stream.bodyTimer) clearTimeout(stream.bodyTimer)
    stream.bodyTimer = setTimeout(() => {
      this.pending.delete(streamId)
      if (stream.bodyController) {
        try {
          stream.bodyController.error(
            new Error(
              `Stream ${streamId} body timed out (no DATA for ${this.bodyTimeoutMs}ms)`
            )
          )
        } catch {}
      }
    }, this.bodyTimeoutMs)
  }

  private async streamBody(
    streamId: number,
    body: ReadableStream<Uint8Array>
  ): Promise<void> {
    const reader = body.getReader()
    this.activeReaders.add(reader)
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          this.sendFn(
            encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true))
          )
          break
        }
        let offset = 0
        while (offset < value.byteLength) {
          const end = Math.min(offset + MAX_PAYLOAD_SIZE, value.byteLength)
          this.sendFn(
            encodeFrame(
              buildDataFrame(streamId, value.subarray(offset, end), false)
            )
          )
          offset = end
        }
      }
    } catch {
      try {
        this.sendFn(encodeFrame(buildRstStreamFrame(streamId)))
      } catch {}
    } finally {
      this.activeReaders.delete(reader)
    }
  }

  /**
   * Send a WS_UPGRADE frame to initiate a WebSocket through the tunnel.
   * Returns the streamId to use for subsequent WS_DATA frames.
   */
  sendWsUpgrade(payload: WsUpgradePayload): number {
    const streamId = this.nextStreamId()
    this.sendFn(encodeFrame(buildWsUpgradeFrame(streamId, payload)))
    return streamId
  }

  /** Send a WS_DATA frame to the tunnel client. */
  sendWsData(streamId: number, data: Uint8Array, isBinary: boolean): void {
    this.sendFn(encodeFrame(buildWsDataFrame(streamId, data, isBinary)))
  }

  /** Send a WS_CLOSE frame to the tunnel client. */
  sendWsClose(streamId: number): void {
    this.sendFn(encodeFrame(buildWsCloseFrame(streamId)))
  }

  /**
   * Handle an incoming frame from the tunnel client.
   */
  handleFrame(frame: Frame): void {
    if (frame.type === FrameType.PONG) {
      return // heartbeat response, ignore
    }

    // Route WebSocket frames to per-stream handlers
    if (frame.type === FrameType.WS_DATA) {
      const handler = this.wsHandlers.get(frame.streamId)
      handler?.onMessage(
        frame.streamId,
        frame.payload,
        !!(frame.flags & Flags.BINARY)
      )
      return
    }
    if (frame.type === FrameType.WS_CLOSE) {
      const handler = this.wsHandlers.get(frame.streamId)
      handler?.onClose(frame.streamId)
      return
    }

    const stream = this.pending.get(frame.streamId)
    if (!stream) {
      return // unknown stream, ignore
    }

    switch (frame.type) {
      case FrameType.HTTP_RES: {
        stream.responseMeta = parseJsonPayload<HttpResponsePayload>(frame)
        // Create ReadableStream and resolve immediately with headers
        const rs = new ReadableStream<Uint8Array>({
          start(controller) {
            stream.bodyController = controller
          },
        })
        stream.resolved = true
        if (stream.timer) clearTimeout(stream.timer)
        stream.timer = null
        // Start body inactivity timer — resets on each DATA frame
        this.startBodyTimer(frame.streamId, stream)
        stream.resolve({
          status: stream.responseMeta.status,
          headers: stream.responseMeta.headers,
          body: rs,
        })
        break
      }

      case FrameType.DATA: {
        if (stream.bodyController) {
          if (frame.payload.byteLength > 0) {
            stream.bodyController.enqueue(frame.payload)
          }
          if (frame.flags & Flags.FIN) {
            if (stream.bodyTimer) clearTimeout(stream.bodyTimer)
            stream.bodyController.close()
            this.pending.delete(frame.streamId)
          } else {
            // Reset body inactivity timer
            this.startBodyTimer(frame.streamId, stream)
          }
        }
        break
      }

      case FrameType.RST_STREAM: {
        if (stream.timer) clearTimeout(stream.timer)
        if (stream.bodyTimer) clearTimeout(stream.bodyTimer)
        this.pending.delete(frame.streamId)
        const err = new Error(`Stream ${frame.streamId} was reset by peer`)
        if (stream.resolved && stream.bodyController) {
          try {
            stream.bodyController.error(err)
          } catch {}
        } else {
          stream.reject(err)
        }
        break
      }
    }
  }

  /**
   * Cancel all pending streams. Called when the WebSocket closes.
   */
  cleanup(): void {
    for (const [streamId, stream] of this.pending) {
      if (stream.timer) clearTimeout(stream.timer)
      if (stream.bodyTimer) clearTimeout(stream.bodyTimer)
      const err = new Error(`Stream ${streamId} closed: tunnel disconnected`)
      if (stream.resolved && stream.bodyController) {
        try {
          stream.bodyController.error(err)
        } catch {}
      } else {
        stream.reject(err)
      }
    }
    this.pending.clear()
    this.wsHandlers.clear()
    // Cancel any active body readers to stop in-flight streamBody() loops
    for (const reader of this.activeReaders) {
      try {
        reader.cancel()
      } catch {}
    }
    this.activeReaders.clear()
  }
}
