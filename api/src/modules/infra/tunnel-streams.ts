import {
  type Frame,
  type HttpRequestPayload,
  type HttpResponsePayload,
  FrameType,
  Flags,
  encodeFrame,
  buildHttpReqFrame,
  buildDataFrames,
  parseJsonPayload,
} from "@smp/factory-shared/tunnel-protocol";

export interface TunnelResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

interface PendingStream {
  resolve: (res: TunnelResponse) => void;
  reject: (err: Error) => void;
  responseMeta: HttpResponsePayload | null;
  dataChunks: Uint8Array[];
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Manages multiplexed streams over a single tunnel WebSocket.
 *
 * Server-initiated streams use even IDs (2, 4, 6, ...).
 * Each stream corresponds to one HTTP request/response pair.
 */
export class StreamManager {
  private nextId = 2; // even IDs for server-initiated
  private pending = new Map<number, PendingStream>();
  private send: (data: Uint8Array) => void;

  constructor(send: (data: Uint8Array) => void) {
    this.send = send;
  }

  nextStreamId(): number {
    const id = this.nextId;
    this.nextId += 2;
    return id;
  }

  /**
   * Send an HTTP request through the tunnel and await the response.
   * Optionally send a request body after the HTTP_REQ frame.
   */
  sendHttpRequest(
    req: HttpRequestPayload,
    opts?: { body?: Uint8Array; timeoutMs?: number }
  ): Promise<TunnelResponse> {
    const streamId = this.nextStreamId();
    const timeoutMs = opts?.timeoutMs ?? 30_000;

    return new Promise<TunnelResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(streamId);
        reject(new Error(`Stream ${streamId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(streamId, {
        resolve,
        reject,
        responseMeta: null,
        dataChunks: [],
        timer,
      });

      // Send HTTP_REQ frame
      const reqFrame = buildHttpReqFrame(streamId, req);
      this.send(encodeFrame(reqFrame));

      // Send body if present, chunked at MAX_PAYLOAD_SIZE with FIN on last frame
      if (opts?.body && opts.body.byteLength > 0) {
        const dataFrames = buildDataFrames(streamId, opts.body);
        for (const df of dataFrames) {
          this.send(encodeFrame(df));
        }
      }
    });
  }

  /**
   * Handle an incoming frame from the tunnel client.
   */
  handleFrame(frame: Frame): void {
    const stream = this.pending.get(frame.streamId);

    if (frame.type === FrameType.PONG) {
      return; // heartbeat response, ignore
    }

    if (!stream) {
      return; // unknown stream, ignore
    }

    switch (frame.type) {
      case FrameType.HTTP_RES: {
        stream.responseMeta = parseJsonPayload<HttpResponsePayload>(frame);
        break;
      }

      case FrameType.DATA: {
        stream.dataChunks.push(frame.payload);
        if (frame.flags & Flags.FIN) {
          this.resolveStream(frame.streamId, stream);
        }
        break;
      }

      case FrameType.RST_STREAM: {
        if (stream.timer) clearTimeout(stream.timer);
        this.pending.delete(frame.streamId);
        stream.reject(new Error(`Stream ${frame.streamId} was reset by peer`));
        break;
      }
    }
  }

  private resolveStream(streamId: number, stream: PendingStream): void {
    if (stream.timer) clearTimeout(stream.timer);
    this.pending.delete(streamId);

    const meta = stream.responseMeta ?? { status: 502, headers: {} };

    // Concatenate all data chunks
    const totalLen = stream.dataChunks.reduce((s, c) => s + c.byteLength, 0);
    const body = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of stream.dataChunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    stream.resolve({ status: meta.status, headers: meta.headers, body });
  }

  /**
   * Cancel all pending streams. Called when the WebSocket closes.
   */
  cleanup(): void {
    for (const [streamId, stream] of this.pending) {
      if (stream.timer) clearTimeout(stream.timer);
      stream.reject(new Error(`Stream ${streamId} closed: tunnel disconnected`));
    }
    this.pending.clear();
  }
}
