# Tunnel Data Plane (Binary Framing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tunnel broker's JSON text protocol with multiplexed binary framing so the factory gateway can forward HTTP requests through WebSocket tunnels to CLI clients and stream responses back.

**Architecture:** A shared frame codec (`shared/src/tunnel-protocol.ts`) defines an 11-byte binary header format. The tunnel broker (`tunnel-broker.ts`) gains a `StreamManager` that allocates stream IDs and correlates request/response frames. The gateway proxy replaces its 501 stub with real tunnel forwarding. The CLI tunnel client handles incoming HTTP_REQ frames by forwarding to localhost and sending HTTP_RES frames back.

**Tech Stack:** TypeScript, Bun (server), WebSocket binary frames, Vitest (tests)

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `shared/src/tunnel-protocol.ts` | Frame types, encode/decode, constants | Create |
| `shared/src/tunnel-protocol.test.ts` | Codec unit tests | Create |
| `api/src/modules/infra/tunnel-broker.ts` | WebSocket handler + stream management | Modify |
| `api/src/modules/infra/tunnel-streams.ts` | StreamManager for multiplexed requests | Create |
| `api/src/modules/infra/tunnel-streams.test.ts` | Stream manager unit tests | Create |
| `api/src/modules/infra/tunnel-relay.test.ts` | E2E relay tests (in-process) | Create |
| `api/src/modules/infra/gateway-proxy.ts` | Tunnel request forwarding | Modify |
| `api/src/modules/infra/gateway-proxy.test.ts` | Tunnel proxy tests | Modify |
| `cli/src/lib/tunnel-client.ts` | Binary frame handling, HTTP forwarding | Modify |
| `cli/src/lib/tunnel-client.test.ts` | Client-side frame handling tests | Create |

---

### Task 1: Frame Codec — Types and Constants

**Files:**
- Create: `shared/src/tunnel-protocol.ts`

This task defines all types and constants. No encode/decode logic yet — just the vocabulary.

- [ ] **Step 1: Create the types and constants file**

Create `shared/src/tunnel-protocol.ts`:

```typescript
/**
 * Binary framing protocol for tunnel data plane.
 *
 * Frame layout (11-byte header + payload):
 *   [0]     version    u8       0x01
 *   [1]     type       u8       FrameType enum
 *   [2..5]  streamId   u32 BE   even=server, odd=client, 0=control
 *   [6]     flags      u8       bitmask: FIN=0x01, RST=0x02, ACK=0x04
 *   [7..10] length     u32 BE   payload byte count (max 65536)
 *   [11..]  payload    bytes
 */

export const PROTOCOL_VERSION = 0x01;
export const HEADER_SIZE = 11;
export const MAX_PAYLOAD_SIZE = 65536;

export const FrameType = {
  CONTROL: 0x00,
  HTTP_REQ: 0x01,
  HTTP_RES: 0x02,
  DATA: 0x03,
  RST_STREAM: 0x06,
  PING: 0x08,
  PONG: 0x09,
  GOAWAY: 0x0a,
} as const;

export type FrameType = (typeof FrameType)[keyof typeof FrameType];

export const Flags = {
  NONE: 0x00,
  FIN: 0x01,
  RST: 0x02,
  ACK: 0x04,
} as const;

export type Flags = number; // bitmask combination

export interface Frame {
  version: number;
  type: FrameType;
  streamId: number;
  flags: number;
  payload: Uint8Array;
}

/**
 * JSON payload for HTTP_REQ frames.
 */
export interface HttpRequestPayload {
  method: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * JSON payload for HTTP_RES frames.
 */
export interface HttpResponsePayload {
  status: number;
  headers: Record<string, string>;
}
```

- [ ] **Step 2: Export from shared index**

In `shared/src/index.ts`, add at the bottom:

```typescript
export * from "./tunnel-protocol.js";
```

- [ ] **Step 3: Commit**

```bash
git add shared/src/tunnel-protocol.ts shared/src/index.ts
git commit -m "feat: add tunnel protocol types and constants"
```

---

### Task 2: Frame Codec — Encode and Decode

**Files:**
- Modify: `shared/src/tunnel-protocol.ts` (add encode/decode functions)
- Create: `shared/src/tunnel-protocol.test.ts`

- [ ] **Step 1: Write failing tests for encode/decode**

Create `shared/src/tunnel-protocol.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  decodeFrame,
  FrameType,
  Flags,
  PROTOCOL_VERSION,
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
  type Frame,
} from "./tunnel-protocol";

describe("tunnel-protocol", () => {
  describe("encodeFrame", () => {
    it("encodes a frame with empty payload", () => {
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        type: FrameType.PING,
        streamId: 0,
        flags: Flags.NONE,
        payload: new Uint8Array(0),
      };
      const buf = encodeFrame(frame);
      expect(buf.byteLength).toBe(HEADER_SIZE);
      expect(buf[0]).toBe(PROTOCOL_VERSION);
      expect(buf[1]).toBe(FrameType.PING);
    });

    it("encodes a frame with payload", () => {
      const payload = new TextEncoder().encode('{"method":"GET"}');
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        type: FrameType.HTTP_REQ,
        streamId: 2,
        flags: Flags.FIN,
        payload,
      };
      const buf = encodeFrame(frame);
      expect(buf.byteLength).toBe(HEADER_SIZE + payload.byteLength);
    });

    it("throws if payload exceeds MAX_PAYLOAD_SIZE", () => {
      const frame: Frame = {
        version: PROTOCOL_VERSION,
        type: FrameType.DATA,
        streamId: 2,
        flags: Flags.NONE,
        payload: new Uint8Array(MAX_PAYLOAD_SIZE + 1),
      };
      expect(() => encodeFrame(frame)).toThrow("exceeds");
    });
  });

  describe("decodeFrame", () => {
    it("round-trips a frame", () => {
      const payload = new TextEncoder().encode("hello");
      const original: Frame = {
        version: PROTOCOL_VERSION,
        type: FrameType.DATA,
        streamId: 42,
        flags: Flags.FIN,
        payload,
      };
      const buf = encodeFrame(original);
      const decoded = decodeFrame(buf);
      expect(decoded.type).toBe(FrameType.DATA);
      expect(decoded.streamId).toBe(42);
      expect(decoded.flags).toBe(Flags.FIN);
      expect(new TextDecoder().decode(decoded.payload)).toBe("hello");
    });

    it("throws on truncated buffer", () => {
      expect(() => decodeFrame(new Uint8Array(5))).toThrow("too short");
    });

    it("throws on wrong version", () => {
      const buf = encodeFrame({
        version: PROTOCOL_VERSION,
        type: FrameType.PING,
        streamId: 0,
        flags: 0,
        payload: new Uint8Array(0),
      });
      buf[0] = 0xff;
      expect(() => decodeFrame(buf)).toThrow("version");
    });
  });

  describe("streamId conventions", () => {
    it("server-initiated streams use even IDs", () => {
      const frame = encodeFrame({
        version: PROTOCOL_VERSION,
        type: FrameType.HTTP_REQ,
        streamId: 2,
        flags: Flags.NONE,
        payload: new Uint8Array(0),
      });
      const decoded = decodeFrame(frame);
      expect(decoded.streamId % 2).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd shared && npx vitest run src/tunnel-protocol.test.ts`
Expected: FAIL — `encodeFrame` and `decodeFrame` not exported

- [ ] **Step 3: Implement encode and decode**

Add to the bottom of `shared/src/tunnel-protocol.ts`:

```typescript
/**
 * Encode a Frame into a binary buffer (header + payload).
 */
export function encodeFrame(frame: Frame): Uint8Array {
  if (frame.payload.byteLength > MAX_PAYLOAD_SIZE) {
    throw new Error(
      `Payload size ${frame.payload.byteLength} exceeds max ${MAX_PAYLOAD_SIZE}`
    );
  }

  const buf = new Uint8Array(HEADER_SIZE + frame.payload.byteLength);
  const view = new DataView(buf.buffer);

  buf[0] = frame.version;
  buf[1] = frame.type;
  view.setUint32(2, frame.streamId, false); // big-endian
  buf[6] = frame.flags;
  view.setUint32(7, frame.payload.byteLength, false); // big-endian

  buf.set(frame.payload, HEADER_SIZE);
  return buf;
}

/**
 * Decode a binary buffer into a Frame.
 */
export function decodeFrame(buf: Uint8Array): Frame {
  if (buf.byteLength < HEADER_SIZE) {
    throw new Error(
      `Buffer too short: ${buf.byteLength} bytes, need at least ${HEADER_SIZE}`
    );
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const version = buf[0];
  if (version !== PROTOCOL_VERSION) {
    throw new Error(`Unknown protocol version: 0x${version.toString(16)}`);
  }

  const type = buf[1] as FrameType;
  const streamId = view.getUint32(2, false);
  const flags = buf[6];
  const length = view.getUint32(7, false);

  if (buf.byteLength < HEADER_SIZE + length) {
    throw new Error(
      `Buffer too short for payload: have ${buf.byteLength - HEADER_SIZE}, need ${length}`
    );
  }

  const payload = buf.slice(HEADER_SIZE, HEADER_SIZE + length);

  return { version, type, streamId, flags, payload };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd shared && npx vitest run src/tunnel-protocol.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add shared/src/tunnel-protocol.ts shared/src/tunnel-protocol.test.ts
git commit -m "feat: add tunnel protocol frame encoder/decoder"
```

---

### Task 3: Frame Codec — Helper Builders

**Files:**
- Modify: `shared/src/tunnel-protocol.ts` (add helper functions)
- Modify: `shared/src/tunnel-protocol.test.ts` (add helper tests)

- [ ] **Step 1: Write failing tests for helpers**

Add to `shared/src/tunnel-protocol.test.ts`:

```typescript
import {
  // ...existing imports...
  buildHttpReqFrame,
  buildHttpResFrame,
  buildDataFrame,
  buildRstStreamFrame,
  buildPingFrame,
  buildPongFrame,
  parseJsonPayload,
  type HttpRequestPayload,
  type HttpResponsePayload,
} from "./tunnel-protocol";

describe("frame builders", () => {
  it("buildHttpReqFrame encodes request metadata", () => {
    const frame = buildHttpReqFrame(2, {
      method: "GET",
      url: "/api/health",
      headers: { host: "example.com" },
    });
    expect(frame.type).toBe(FrameType.HTTP_REQ);
    expect(frame.streamId).toBe(2);
    expect(frame.flags).toBe(Flags.NONE);
    const parsed = parseJsonPayload<HttpRequestPayload>(frame);
    expect(parsed.method).toBe("GET");
    expect(parsed.url).toBe("/api/health");
  });

  it("buildHttpResFrame encodes response metadata", () => {
    const frame = buildHttpResFrame(2, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    expect(frame.type).toBe(FrameType.HTTP_RES);
    const parsed = parseJsonPayload<HttpResponsePayload>(frame);
    expect(parsed.status).toBe(200);
  });

  it("buildDataFrame with FIN flag", () => {
    const body = new TextEncoder().encode("response body");
    const frame = buildDataFrame(2, body, true);
    expect(frame.type).toBe(FrameType.DATA);
    expect(frame.flags).toBe(Flags.FIN);
    expect(new TextDecoder().decode(frame.payload)).toBe("response body");
  });

  it("buildDataFrame without FIN flag", () => {
    const body = new TextEncoder().encode("chunk");
    const frame = buildDataFrame(2, body, false);
    expect(frame.flags).toBe(Flags.NONE);
  });

  it("buildRstStreamFrame", () => {
    const frame = buildRstStreamFrame(4);
    expect(frame.type).toBe(FrameType.RST_STREAM);
    expect(frame.streamId).toBe(4);
    expect(frame.flags).toBe(Flags.RST);
  });

  it("buildPingFrame / buildPongFrame round-trip", () => {
    const ping = buildPingFrame();
    expect(ping.type).toBe(FrameType.PING);
    expect(ping.streamId).toBe(0);
    const pong = buildPongFrame();
    expect(pong.type).toBe(FrameType.PONG);
    expect(pong.streamId).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd shared && npx vitest run src/tunnel-protocol.test.ts`
Expected: FAIL — builders not exported

- [ ] **Step 3: Implement helpers**

Add to the bottom of `shared/src/tunnel-protocol.ts`:

```typescript
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Parse a frame's payload as JSON.
 */
export function parseJsonPayload<T>(frame: Frame): T {
  return JSON.parse(decoder.decode(frame.payload));
}

function jsonPayload(obj: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(obj));
}

function makeFrame(
  type: FrameType,
  streamId: number,
  flags: number,
  payload: Uint8Array
): Frame {
  return { version: PROTOCOL_VERSION, type, streamId, flags, payload };
}

export function buildHttpReqFrame(
  streamId: number,
  req: HttpRequestPayload
): Frame {
  return makeFrame(FrameType.HTTP_REQ, streamId, Flags.NONE, jsonPayload(req));
}

export function buildHttpResFrame(
  streamId: number,
  res: HttpResponsePayload
): Frame {
  return makeFrame(FrameType.HTTP_RES, streamId, Flags.NONE, jsonPayload(res));
}

export function buildDataFrame(
  streamId: number,
  data: Uint8Array,
  fin: boolean
): Frame {
  return makeFrame(
    FrameType.DATA,
    streamId,
    fin ? Flags.FIN : Flags.NONE,
    data
  );
}

export function buildRstStreamFrame(streamId: number): Frame {
  return makeFrame(
    FrameType.RST_STREAM,
    streamId,
    Flags.RST,
    new Uint8Array(0)
  );
}

export function buildPingFrame(): Frame {
  return makeFrame(
    FrameType.PING,
    0,
    Flags.NONE,
    new Uint8Array(0)
  );
}

export function buildPongFrame(): Frame {
  return makeFrame(
    FrameType.PONG,
    0,
    Flags.NONE,
    new Uint8Array(0)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd shared && npx vitest run src/tunnel-protocol.test.ts`
Expected: All 13 tests PASS

- [ ] **Step 5: Commit**

```bash
git add shared/src/tunnel-protocol.ts shared/src/tunnel-protocol.test.ts
git commit -m "feat: add tunnel protocol frame builder helpers"
```

---

### Task 4: Stream Manager (Broker-Side)

**Files:**
- Create: `api/src/modules/infra/tunnel-streams.ts`
- Create: `api/src/modules/infra/tunnel-streams.test.ts`

The `StreamManager` lives on the server side. It allocates even stream IDs, tracks pending requests, and resolves them when response frames arrive.

- [ ] **Step 1: Write failing tests**

Create `api/src/modules/infra/tunnel-streams.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { StreamManager } from "./tunnel-streams";
import {
  FrameType,
  Flags,
  encodeFrame,
  buildHttpResFrame,
  buildDataFrame,
  PROTOCOL_VERSION,
} from "@smp/factory-shared/tunnel-protocol";

describe("StreamManager", () => {
  let sm: StreamManager;
  const mockSend = vi.fn();

  beforeEach(() => {
    mockSend.mockReset();
    sm = new StreamManager(mockSend);
  });

  it("allocates even stream IDs starting at 2", () => {
    const id1 = sm.nextStreamId();
    const id2 = sm.nextStreamId();
    expect(id1).toBe(2);
    expect(id2).toBe(4);
    expect(id1 % 2).toBe(0);
    expect(id2 % 2).toBe(0);
  });

  it("sendHttpRequest sends HTTP_REQ frame and returns a promise", async () => {
    const promise = sm.sendHttpRequest({
      method: "GET",
      url: "/health",
      headers: { host: "test.tunnel.dx.dev" },
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentBuf = mockSend.mock.calls[0][0] as Uint8Array;
    expect(sentBuf[1]).toBe(FrameType.HTTP_REQ);

    // Simulate response
    sm.handleFrame({
      version: PROTOCOL_VERSION,
      type: FrameType.HTTP_RES,
      streamId: 2,
      flags: Flags.NONE,
      payload: new TextEncoder().encode(
        JSON.stringify({ status: 200, headers: { "content-type": "text/plain" } })
      ),
    });
    sm.handleFrame({
      version: PROTOCOL_VERSION,
      type: FrameType.DATA,
      streamId: 2,
      flags: Flags.FIN,
      payload: new TextEncoder().encode("OK"),
    });

    const res = await promise;
    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(res.body)).toBe("OK");
  });

  it("times out pending requests", async () => {
    vi.useFakeTimers();
    const promise = sm.sendHttpRequest(
      { method: "GET", url: "/slow", headers: {} },
      { timeoutMs: 100 }
    );
    vi.advanceTimersByTime(150);
    await expect(promise).rejects.toThrow("timed out");
    vi.useRealTimers();
  });

  it("handleFrame with RST_STREAM rejects the pending request", async () => {
    const promise = sm.sendHttpRequest({
      method: "GET",
      url: "/fail",
      headers: {},
    });

    sm.handleFrame({
      version: PROTOCOL_VERSION,
      type: FrameType.RST_STREAM,
      streamId: 2,
      flags: Flags.RST,
      payload: new Uint8Array(0),
    });

    await expect(promise).rejects.toThrow("reset");
  });

  it("assembles multi-chunk DATA frames", async () => {
    const promise = sm.sendHttpRequest({
      method: "GET",
      url: "/big",
      headers: {},
    });

    sm.handleFrame(
      buildHttpResFrame(2, { status: 200, headers: {} })
    );
    sm.handleFrame(
      buildDataFrame(2, new TextEncoder().encode("chunk1"), false)
    );
    sm.handleFrame(
      buildDataFrame(2, new TextEncoder().encode("chunk2"), true)
    );

    const res = await promise;
    expect(new TextDecoder().decode(res.body)).toBe("chunk1chunk2");
  });

  it("cleanup cancels all pending streams", async () => {
    const p1 = sm.sendHttpRequest({ method: "GET", url: "/a", headers: {} });
    const p2 = sm.sendHttpRequest({ method: "GET", url: "/b", headers: {} });
    sm.cleanup();
    await expect(p1).rejects.toThrow("closed");
    await expect(p2).rejects.toThrow("closed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run src/modules/infra/tunnel-streams.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement StreamManager**

Create `api/src/modules/infra/tunnel-streams.ts`:

```typescript
import {
  type Frame,
  type HttpRequestPayload,
  type HttpResponsePayload,
  FrameType,
  Flags,
  encodeFrame,
  buildHttpReqFrame,
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

      // Send body if present, with FIN flag
      if (opts?.body && opts.body.byteLength > 0) {
        const dataFrame: Frame = {
          version: reqFrame.version,
          type: FrameType.DATA,
          streamId,
          flags: Flags.FIN,
          payload: opts.body,
        };
        this.send(encodeFrame(dataFrame));
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run src/modules/infra/tunnel-streams.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/infra/tunnel-streams.ts api/src/modules/infra/tunnel-streams.test.ts
git commit -m "feat: add StreamManager for multiplexed tunnel requests"
```

---

### Task 5: Wire Broker to Binary Framing

**Files:**
- Modify: `api/src/modules/infra/tunnel-broker.ts`

Currently the broker only handles JSON `"register"` messages. After registration, all subsequent messages should be binary frames routed through a `StreamManager`. The broker also needs to handle PING/PONG.

- [ ] **Step 1: Update tunnel-broker.ts**

Replace the entire contents of `api/src/modules/infra/tunnel-broker.ts`:

```typescript
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
```

- [ ] **Step 2: Run existing tests to verify nothing broke**

Run: `cd api && npx vitest run src/modules/infra/tunnel-streams.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/infra/tunnel-broker.ts
git commit -m "feat: upgrade tunnel broker to binary framing protocol"
```

---

### Task 6: Gateway Tunnel Forwarding

**Files:**
- Modify: `api/src/modules/infra/gateway-proxy.ts` (replace 501 stub with tunnel relay)
- Modify: `api/src/modules/infra/gateway.controller.ts` (pass getTunnelStreamManager)

The gateway currently returns 501 for tunnel requests. Replace that with actual forwarding through the `StreamManager`.

- [ ] **Step 1: Update GatewayServerOptions**

In `api/src/modules/infra/gateway-proxy.ts`, update the interface and imports. Add this import at the top:

```typescript
import type { StreamManager } from "./tunnel-streams";
```

Change `GatewayServerOptions` (line 76-80) to:

```typescript
export interface GatewayServerOptions {
  cache: RouteCache;
  port?: number;
  getTunnelStreamManager?: (subdomain: string) => StreamManager | undefined;
}
```

- [ ] **Step 2: Replace the 501 tunnel handler**

In `createGatewayServer` (line 82-144), replace lines 108-111:

```typescript
      // For tunnels, delegate to tunnel relay (Phase 3)
      if (parsed.family === "tunnel") {
        return new Response("Tunnel relay not yet implemented", { status: 501 });
      }
```

With:

```typescript
      // Forward tunnel requests through WebSocket
      if (parsed.family === "tunnel") {
        const sm = opts.getTunnelStreamManager?.(parsed.slug);
        if (!sm) {
          return new Response("Tunnel Not Connected", { status: 502 });
        }

        try {
          // Build HTTP_REQ payload from incoming request
          const headerObj: Record<string, string> = {};
          req.headers.forEach((val, key) => {
            headerObj[key] = val;
          });

          const reqBody = req.body
            ? new Uint8Array(await new Response(req.body).arrayBuffer())
            : undefined;

          const tunnelRes = await sm.sendHttpRequest(
            {
              method: req.method,
              url: new URL(req.url).pathname + new URL(req.url).search,
              headers: headerObj,
            },
            { body: reqBody, timeoutMs: 30_000 }
          );

          return new Response(tunnelRes.body, {
            status: tunnelRes.status,
            headers: tunnelRes.headers,
          });
        } catch {
          return new Response("Gateway Timeout", { status: 504 });
        }
      }
```

- [ ] **Step 3: Update startGateway to pass getTunnelStreamManager**

In `startGateway` (line 208-225), change the function signature and the `createGatewayServer` call.

Replace `startGateway`:

```typescript
export function startGateway(opts: {
  db: Database;
  port?: number;
  getTunnelStreamManager?: (subdomain: string) => StreamManager | undefined;
}) {
  const cache = new RouteCache({
    lookup: (domain) => lookupRouteByDomain(opts.db, domain),
    maxSize: 10_000,
    ttlMs: 300_000,
  });

  // Wire up cache invalidation
  setRouteChangeListener((domain) => cache.invalidate(domain));

  const gw = createGatewayServer({
    cache,
    port: opts.port ?? 9090,
    getTunnelStreamManager: opts.getTunnelStreamManager,
  });

  return { ...gw, cache };
}
```

- [ ] **Step 4: Update gateway.controller.ts**

In `api/src/modules/infra/gateway.controller.ts`, change the `onStart` handler (lines 108-112) from:

```typescript
    .onStart(async () => {
      const { startGateway } = await import("./gateway-proxy");
      const { getTunnelSocket } = await import("./tunnel-broker");
      startGateway({ db, port: 9090, getTunnelSocket });
    })
```

To:

```typescript
    .onStart(async () => {
      const { startGateway } = await import("./gateway-proxy");
      const { getTunnelStreamManager } = await import("./tunnel-broker");
      startGateway({ db, port: 9090, getTunnelStreamManager });
    })
```

- [ ] **Step 5: Run existing tests**

Run: `cd api && npx vitest run src/modules/infra/gateway-proxy.test.ts`
Expected: 14 vitest-compatible tests pass (the 4 Bun.serve tests still fail with "Bun is not defined" — that's expected)

Run: `cd api && bun test src/modules/infra/gateway-proxy.test.ts`
Expected: All 18 tests pass. The existing "returns 404 for unknown hostname" and "returns 502 when target is unreachable" tests still work because they test preview/sandbox routes, not tunnels.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/infra/gateway-proxy.ts api/src/modules/infra/gateway.controller.ts
git commit -m "feat: wire gateway to forward tunnel requests via binary framing"
```

---

### Task 7: CLI Tunnel Client — Binary Frame Handling

**Files:**
- Modify: `cli/src/lib/tunnel-client.ts`

The CLI client currently only handles JSON text messages. After registration, it needs to handle binary frames: decode incoming HTTP_REQ frames, forward to localhost, and send HTTP_RES + DATA frames back.

- [ ] **Step 1: Rewrite tunnel-client.ts**

Replace the entire contents of `cli/src/lib/tunnel-client.ts`:

```typescript
import { readConfig, resolveFactoryUrl } from "../config.js";
import { getStoredBearerToken } from "../session-token.js";
import {
  decodeFrame,
  encodeFrame,
  buildHttpResFrame,
  buildDataFrame,
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
function handleBinaryFrame(
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

    // Send HTTP_RES frame with status + headers
    const resHeaders: Record<string, string> = {};
    localRes.headers.forEach((val, key) => {
      resHeaders[key] = val;
    });
    ws.send(
      encodeFrame(
        buildHttpResFrame(streamId, {
          status: localRes.status,
          headers: resHeaders,
        })
      )
    );

    // Send body as DATA frame(s) with FIN
    if (localRes.body) {
      const body = new Uint8Array(await localRes.arrayBuffer());
      ws.send(encodeFrame(buildDataFrame(streamId, body, true)));
    } else {
      ws.send(
        encodeFrame(buildDataFrame(streamId, new Uint8Array(0), true))
      );
    }
  } catch {
    // Local server unreachable
    ws.send(encodeFrame(buildRstStreamFrame(streamId)));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add cli/src/lib/tunnel-client.ts
git commit -m "feat: upgrade CLI tunnel client to binary framing protocol"
```

---

### Task 8: CLI Tunnel Client Tests

**Files:**
- Create: `cli/src/lib/tunnel-client.test.ts`

Test the `handleBinaryFrame` logic in isolation. Since `handleBinaryFrame` is not exported, we test it indirectly by verifying the protocol round-trip behavior. We'll extract and export the handler for testability.

- [ ] **Step 1: Export handleBinaryFrame for testing**

In `cli/src/lib/tunnel-client.ts`, change:

```typescript
function handleBinaryFrame(
```

To:

```typescript
export function handleBinaryFrame(
```

- [ ] **Step 2: Write tests**

First, check how CLI tests run:

Run: `ls cli/package.json` and check test config.

Create `cli/src/lib/tunnel-client.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleBinaryFrame } from "./tunnel-client";
import {
  encodeFrame,
  decodeFrame,
  buildPingFrame,
  buildHttpReqFrame,
  FrameType,
  Flags,
  PROTOCOL_VERSION,
} from "@smp/factory-shared/tunnel-protocol";

describe("handleBinaryFrame", () => {
  let ws: { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    ws = { send: vi.fn(), close: vi.fn() };
  });

  it("responds to PING with PONG", () => {
    const pingBuf = encodeFrame(buildPingFrame());
    handleBinaryFrame(pingBuf, ws as any, 3000);

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sentBuf = ws.send.mock.calls[0][0] as Uint8Array;
    const frame = decodeFrame(sentBuf);
    expect(frame.type).toBe(FrameType.PONG);
  });

  it("forwards HTTP_REQ to localhost and sends back HTTP_RES + DATA", async () => {
    // Mock global fetch to simulate localhost response
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("hello from local", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    );

    const reqFrame = buildHttpReqFrame(2, {
      method: "GET",
      url: "/api/health",
      headers: { host: "test.tunnel.dx.dev" },
    });
    const reqBuf = encodeFrame(reqFrame);
    handleBinaryFrame(reqBuf, ws as any, 3000);

    // Wait for async fetch to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/health",
      expect.objectContaining({ method: "GET" })
    );

    // Should have sent HTTP_RES + DATA frames
    expect(ws.send.mock.calls.length).toBeGreaterThanOrEqual(2);

    const resFrame = decodeFrame(ws.send.mock.calls[0][0] as Uint8Array);
    expect(resFrame.type).toBe(FrameType.HTTP_RES);
    expect(resFrame.streamId).toBe(2);

    const dataFrame = decodeFrame(ws.send.mock.calls[1][0] as Uint8Array);
    expect(dataFrame.type).toBe(FrameType.DATA);
    expect(dataFrame.flags & Flags.FIN).toBeTruthy();
    expect(new TextDecoder().decode(dataFrame.payload)).toBe("hello from local");

    globalThis.fetch = originalFetch;
  });

  it("sends RST_STREAM when localhost is unreachable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const reqFrame = buildHttpReqFrame(4, {
      method: "GET",
      url: "/fail",
      headers: {},
    });
    handleBinaryFrame(encodeFrame(reqFrame), ws as any, 9999);

    await new Promise((r) => setTimeout(r, 50));

    const sentBuf = ws.send.mock.calls[0][0] as Uint8Array;
    const frame = decodeFrame(sentBuf);
    expect(frame.type).toBe(FrameType.RST_STREAM);
    expect(frame.streamId).toBe(4);

    globalThis.fetch = originalFetch;
  });

  it("ignores malformed binary data", () => {
    handleBinaryFrame(new Uint8Array([0xff, 0xff]), ws as any, 3000);
    expect(ws.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd cli && npx vitest run src/lib/tunnel-client.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

```bash
git add cli/src/lib/tunnel-client.ts cli/src/lib/tunnel-client.test.ts
git commit -m "test: add CLI tunnel client binary framing tests"
```

---

### Task 9: End-to-End Tunnel Relay Test

**Files:**
- Create: `api/src/modules/infra/tunnel-relay.test.ts`

This test verifies the full tunnel relay path in-process: gateway sends HTTP_REQ through StreamManager → "client" responds with HTTP_RES + DATA → gateway gets the response. No real WebSocket — just testing the frame protocol end-to-end.

- [ ] **Step 1: Write the e2e test**

Create `api/src/modules/infra/tunnel-relay.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { StreamManager } from "./tunnel-streams";
import {
  decodeFrame,
  encodeFrame,
  buildHttpResFrame,
  buildDataFrame,
  buildRstStreamFrame,
  parseJsonPayload,
  FrameType,
  type HttpRequestPayload,
} from "@smp/factory-shared/tunnel-protocol";

/**
 * Simulates a CLI tunnel client: receives HTTP_REQ frames,
 * forwards to a mock local server, sends HTTP_RES + DATA back.
 */
function createMockClient(
  localHandler: (req: HttpRequestPayload) => { status: number; headers: Record<string, string>; body: string }
) {
  let sendToServer: ((data: Uint8Array) => void) | null = null;

  return {
    /** Called when "client" receives a binary message from the "broker" */
    onMessage(data: Uint8Array) {
      const frame = decodeFrame(data);
      if (frame.type === FrameType.HTTP_REQ) {
        const req = parseJsonPayload<HttpRequestPayload>(frame);
        const res = localHandler(req);

        // Send HTTP_RES
        sendToServer!(
          encodeFrame(buildHttpResFrame(frame.streamId, {
            status: res.status,
            headers: res.headers,
          }))
        );

        // Send DATA with FIN
        sendToServer!(
          encodeFrame(
            buildDataFrame(
              frame.streamId,
              new TextEncoder().encode(res.body),
              true
            )
          )
        );
      }
    },
    setSendToServer(fn: (data: Uint8Array) => void) {
      sendToServer = fn;
    },
  };
}

describe("Tunnel Relay E2E (in-process)", () => {
  it("full round-trip: gateway → broker → client → localhost → back", async () => {
    // Set up mock client that simulates localhost:3000
    const client = createMockClient((req) => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: req.url, method: req.method }),
    }));

    // StreamManager sends frames to "client"
    const sm = new StreamManager((data) => {
      // Simulate: broker sends binary frame over WebSocket to client
      client.onMessage(data);
    });

    // Client sends frames back to StreamManager
    client.setSendToServer((data) => {
      const frame = decodeFrame(data);
      sm.handleFrame(frame);
    });

    // Gateway sends HTTP request through tunnel
    const res = await sm.sendHttpRequest({
      method: "GET",
      url: "/api/health",
      headers: { host: "test.tunnel.dx.dev" },
    });

    expect(res.status).toBe(200);
    const body = JSON.parse(new TextDecoder().decode(res.body));
    expect(body.path).toBe("/api/health");
    expect(body.method).toBe("GET");
  });

  it("handles client RST_STREAM (localhost unreachable)", async () => {
    const client = createMockClient(() => {
      throw new Error("ECONNREFUSED");
    });

    const sm = new StreamManager((data) => {
      try {
        client.onMessage(data);
      } catch {
        // Client sends RST_STREAM on error
        const frame = decodeFrame(data);
        sm.handleFrame({
          ...buildRstStreamFrame(frame.streamId),
        });
      }
    });

    client.setSendToServer((data) => {
      const frame = decodeFrame(data);
      sm.handleFrame(frame);
    });

    await expect(
      sm.sendHttpRequest({
        method: "GET",
        url: "/fail",
        headers: {},
      })
    ).rejects.toThrow("reset");
  });

  it("concurrent requests on different streams", async () => {
    const client = createMockClient((req) => ({
      status: 200,
      headers: {},
      body: `response-for-${req.url}`,
    }));

    const sm = new StreamManager((data) => {
      client.onMessage(data);
    });

    client.setSendToServer((data) => {
      sm.handleFrame(decodeFrame(data));
    });

    // Fire two requests concurrently
    const [res1, res2] = await Promise.all([
      sm.sendHttpRequest({ method: "GET", url: "/a", headers: {} }),
      sm.sendHttpRequest({ method: "GET", url: "/b", headers: {} }),
    ]);

    expect(new TextDecoder().decode(res1.body)).toBe("response-for-/a");
    expect(new TextDecoder().decode(res2.body)).toBe("response-for-/b");
  });

  it("timeout when client never responds", async () => {
    vi.useFakeTimers();

    // StreamManager sends to a black hole
    const sm = new StreamManager(() => {});

    const promise = sm.sendHttpRequest(
      { method: "GET", url: "/timeout", headers: {} },
      { timeoutMs: 5_000 }
    );

    vi.advanceTimersByTime(6_000);
    await expect(promise).rejects.toThrow("timed out");

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd api && npx vitest run src/modules/infra/tunnel-relay.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 3: Run full test suites**

Run: `cd api && npx vitest run`
Report results — all unit tests should pass. The 4 Bun.serve failures and PGlite integration failures are pre-existing.

Run: `cd shared && npx vitest run`
Report results — all tunnel-protocol tests should pass.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/infra/tunnel-relay.test.ts
git commit -m "test: add end-to-end tunnel relay integration tests"
```

---

## Verification Checklist

After all tasks are complete, verify:

1. **Frame codec**: `cd shared && npx vitest run src/tunnel-protocol.test.ts` — all pass
2. **StreamManager**: `cd api && npx vitest run src/modules/infra/tunnel-streams.test.ts` — all pass
3. **E2E relay**: `cd api && npx vitest run src/modules/infra/tunnel-relay.test.ts` — all pass
4. **Gateway proxy**: `cd api && bun test src/modules/infra/gateway-proxy.test.ts` — all pass (18 tests)
5. **CLI client**: `cd cli && npx vitest run src/lib/tunnel-client.test.ts` — all pass
6. **No regressions**: `cd api && npx vitest run` — 150+ pass, same 4 Bun failures as before
7. **Shared package**: `cd shared && npx vitest run` — all pass including new protocol tests
