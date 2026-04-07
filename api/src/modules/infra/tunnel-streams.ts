import {
  type Frame,
  type HttpRequestPayload,
  type HttpResponsePayload,
  type WsUpgradePayload,
  FrameType,
  Flags,
  encodeFrame,
  buildHttpReqFrame,
  buildDataFrame,
  buildDataFrames,
  buildRstStreamFrame,
  buildWsUpgradeFrame,
  buildWsDataFrame,
  buildWsCloseFrame,
  parseJsonPayload,
  MAX_PAYLOAD_SIZE,
} from "@smp/factory-shared/tunnel-protocol";

export interface TunnelResponse {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}

interface PendingStream {
  resolve: (res: TunnelResponse) => void;
  reject: (err: Error) => void;
  responseMeta: HttpResponsePayload | null;
  bodyController: ReadableStreamDefaultController<Uint8Array> | null;
  resolved: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Manages multiplexed streams over a single tunnel WebSocket.
 *
 * Server-initiated streams use even IDs (2, 4, 6, ...).
 * Each stream corresponds to one HTTP request/response pair.
 */
export type WsMessageHandler = (streamId: number, data: Uint8Array, isBinary: boolean) => void;
export type WsCloseHandler = (streamId: number) => void;

export class StreamManager {
  private nextId = 2; // even IDs for server-initiated
  private pending = new Map<number, PendingStream>();
  private sendFn: (data: Uint8Array) => void;
  private maxConcurrentStreams: number;

  /** Callback for incoming WS_DATA frames from the tunnel client. */
  onWsMessage: WsMessageHandler | null = null;
  /** Callback for incoming WS_CLOSE frames from the tunnel client. */
  onWsClose: WsCloseHandler | null = null;

  constructor(send: (data: Uint8Array) => void, opts?: { maxConcurrentStreams?: number }) {
    this.sendFn = send;
    this.maxConcurrentStreams = opts?.maxConcurrentStreams ?? 256;
  }

  nextStreamId(): number {
    const id = this.nextId;
    this.nextId += 2;
    if (this.nextId > 0xfffffffe) {
      this.nextId = 2;
    }
    // Skip IDs that are still in-flight
    while (this.pending.has(this.nextId)) {
      this.nextId += 2;
      if (this.nextId > 0xfffffffe) {
        this.nextId = 2;
      }
    }
    return id;
  }

  /**
   * Send an HTTP request through the tunnel and await the response.
   * Body can be a Uint8Array (buffered) or ReadableStream (streamed).
   */
  sendHttpRequest(
    req: HttpRequestPayload,
    opts?: { body?: ReadableStream<Uint8Array> | Uint8Array; timeoutMs?: number }
  ): Promise<TunnelResponse> {
    if (this.pending.size >= this.maxConcurrentStreams) {
      return Promise.reject(new Error("Too many concurrent streams"));
    }

    const streamId = this.nextStreamId();
    const timeoutMs = opts?.timeoutMs ?? 30_000;

    return new Promise<TunnelResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const stream = this.pending.get(streamId);
        this.pending.delete(streamId);
        if (stream?.resolved && stream.bodyController) {
          try { stream.bodyController.error(new Error(`Stream ${streamId} timed out after ${timeoutMs}ms`)); } catch {}
        } else {
          reject(new Error(`Stream ${streamId} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pending.set(streamId, {
        resolve,
        reject,
        responseMeta: null,
        bodyController: null,
        resolved: false,
        timer,
      });

      // Send HTTP_REQ frame
      const reqFrame = buildHttpReqFrame(streamId, req);
      this.sendFn(encodeFrame(reqFrame));

      // Send body if present
      if (opts?.body) {
        if (opts.body instanceof ReadableStream) {
          this.streamBody(streamId, opts.body);
        } else if (opts.body.byteLength > 0) {
          const dataFrames = buildDataFrames(streamId, opts.body);
          for (const df of dataFrames) {
            this.sendFn(encodeFrame(df));
          }
        }
      }
    });
  }

  private async streamBody(streamId: number, body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          this.sendFn(encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true)));
          break;
        }
        let offset = 0;
        while (offset < value.byteLength) {
          const end = Math.min(offset + MAX_PAYLOAD_SIZE, value.byteLength);
          this.sendFn(encodeFrame(buildDataFrame(streamId, value.subarray(offset, end), false)));
          offset = end;
        }
      }
    } catch {
      this.sendFn(encodeFrame(buildRstStreamFrame(streamId)));
    }
  }

  /**
   * Send a WS_UPGRADE frame to initiate a WebSocket through the tunnel.
   * Returns the streamId to use for subsequent WS_DATA frames.
   */
  sendWsUpgrade(payload: WsUpgradePayload): number {
    const streamId = this.nextStreamId();
    this.sendFn(encodeFrame(buildWsUpgradeFrame(streamId, payload)));
    return streamId;
  }

  /** Send a WS_DATA frame to the tunnel client. */
  sendWsData(streamId: number, data: Uint8Array, isBinary: boolean): void {
    this.sendFn(encodeFrame(buildWsDataFrame(streamId, data, isBinary)));
  }

  /** Send a WS_CLOSE frame to the tunnel client. */
  sendWsClose(streamId: number): void {
    this.sendFn(encodeFrame(buildWsCloseFrame(streamId)));
  }

  /**
   * Handle an incoming frame from the tunnel client.
   */
  handleFrame(frame: Frame): void {
    if (frame.type === FrameType.PONG) {
      return; // heartbeat response, ignore
    }

    // Route WebSocket frames to callbacks (not tied to pending HTTP streams)
    if (frame.type === FrameType.WS_DATA) {
      this.onWsMessage?.(frame.streamId, frame.payload, !!(frame.flags & Flags.BINARY));
      return;
    }
    if (frame.type === FrameType.WS_CLOSE) {
      this.onWsClose?.(frame.streamId);
      return;
    }

    const stream = this.pending.get(frame.streamId);
    if (!stream) {
      return; // unknown stream, ignore
    }

    switch (frame.type) {
      case FrameType.HTTP_RES: {
        stream.responseMeta = parseJsonPayload<HttpResponsePayload>(frame);
        // Create ReadableStream and resolve immediately with headers
        const rs = new ReadableStream<Uint8Array>({
          start(controller) {
            stream.bodyController = controller;
          },
        });
        stream.resolved = true;
        if (stream.timer) clearTimeout(stream.timer);
        stream.resolve({
          status: stream.responseMeta.status,
          headers: stream.responseMeta.headers,
          body: rs,
        });
        break;
      }

      case FrameType.DATA: {
        if (stream.bodyController) {
          if (frame.payload.byteLength > 0) {
            stream.bodyController.enqueue(frame.payload);
          }
          if (frame.flags & Flags.FIN) {
            stream.bodyController.close();
            this.pending.delete(frame.streamId);
          }
        }
        break;
      }

      case FrameType.RST_STREAM: {
        if (stream.timer) clearTimeout(stream.timer);
        this.pending.delete(frame.streamId);
        const err = new Error(`Stream ${frame.streamId} was reset by peer`);
        if (stream.resolved && stream.bodyController) {
          try { stream.bodyController.error(err); } catch {}
        } else {
          stream.reject(err);
        }
        break;
      }
    }
  }

  /**
   * Cancel all pending streams. Called when the WebSocket closes.
   */
  cleanup(): void {
    for (const [streamId, stream] of this.pending) {
      if (stream.timer) clearTimeout(stream.timer);
      const err = new Error(`Stream ${streamId} closed: tunnel disconnected`);
      if (stream.resolved && stream.bodyController) {
        try { stream.bodyController.error(err); } catch {}
      } else {
        stream.reject(err);
      }
    }
    this.pending.clear();
  }
}
