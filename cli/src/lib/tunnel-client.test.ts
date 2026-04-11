import {
  Flags,
  FrameType,
  MAX_PAYLOAD_SIZE,
  PROTOCOL_VERSION,
  buildDataFrame,
  buildDataFrames,
  buildHttpReqFrame,
  buildPingFrame,
  buildWsDataFrame,
  buildWsUpgradeFrame,
  decodeFrame,
  encodeFrame,
} from "@smp/factory-shared/tunnel-protocol"
import { beforeEach, describe, expect, it, mock } from "bun:test"

import {
  type PendingBodies,
  type WsConnectQueues,
  getWsConnectQueue,
  handleBinaryFrame,
} from "./tunnel-client"

/** ws.send receives ArrayBuffer (via the buf() helper), wrap back to Uint8Array for decoding. */
function decodeSent(raw: unknown): ReturnType<typeof decodeFrame> {
  const bytes =
    raw instanceof ArrayBuffer ? new Uint8Array(raw) : (raw as Uint8Array)
  return decodeFrame(bytes)
}

describe("handleBinaryFrame", () => {
  let ws: { send: ReturnType<typeof mock>; close: ReturnType<typeof mock> }

  beforeEach(() => {
    ws = { send: mock(), close: mock() }
  })

  it("responds to PING with PONG", () => {
    const pingBuf = encodeFrame(buildPingFrame())
    handleBinaryFrame(pingBuf, ws as any, 3000)

    expect(ws.send).toHaveBeenCalledTimes(1)
    const frame = decodeSent(ws.send.mock.calls[0][0])
    expect(frame.type).toBe(FrameType.PONG)
  })

  it("forwards HTTP_REQ to localhost and sends back HTTP_RES + DATA", async () => {
    // Mock global fetch to simulate localhost response
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock().mockResolvedValue(
      new Response("hello from local", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    ) as any

    const reqFrame = buildHttpReqFrame(2, {
      method: "GET",
      url: "/api/health",
      headers: { host: "test.tunnel.dx.dev" },
    })
    const reqBuf = encodeFrame(reqFrame)
    handleBinaryFrame(reqBuf, ws as any, 3000)

    // Wait for async fetch to complete
    await new Promise((r) => setTimeout(r, 50))

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/health",
      expect.objectContaining({ method: "GET" })
    )

    // Should have sent HTTP_RES + DATA frame(s) + FIN frame
    expect(ws.send.mock.calls.length).toBeGreaterThanOrEqual(2)

    const resFrame = decodeSent(ws.send.mock.calls[0][0])
    expect(resFrame.type).toBe(FrameType.HTTP_RES)
    expect(resFrame.streamId).toBe(2)

    // Collect all DATA frames and concatenate body
    const dataFrames = ws.send.mock.calls
      .slice(1)
      .map((call: any) => decodeSent(call[0]))
      .filter((f: any) => f.type === FrameType.DATA)

    const bodyParts: Uint8Array[] = []
    let hasFin = false
    for (const df of dataFrames) {
      if (df.payload.byteLength > 0) bodyParts.push(df.payload)
      if (df.flags & Flags.FIN) hasFin = true
    }
    expect(hasFin).toBe(true)
    const totalLen = bodyParts.reduce(
      (s: number, c: Uint8Array) => s + c.byteLength,
      0
    )
    const body = new Uint8Array(totalLen)
    let offset = 0
    for (const part of bodyParts) {
      body.set(part, offset)
      offset += part.byteLength
    }
    expect(new TextDecoder().decode(body)).toBe("hello from local")

    globalThis.fetch = originalFetch
  })

  it("sends RST_STREAM when localhost is unreachable", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock().mockRejectedValue(
      new Error("ECONNREFUSED")
    ) as any

    const reqFrame = buildHttpReqFrame(4, {
      method: "GET",
      url: "/fail",
      headers: {},
    })
    handleBinaryFrame(encodeFrame(reqFrame), ws as any, 9999)

    await new Promise((r) => setTimeout(r, 50))

    const frame = decodeSent(ws.send.mock.calls[0][0])
    expect(frame.type).toBe(FrameType.RST_STREAM)
    expect(frame.streamId).toBe(4)

    globalThis.fetch = originalFetch
  })

  it("ignores malformed binary data", () => {
    handleBinaryFrame(new Uint8Array([0xff, 0xff]), ws as any, 3000)
    expect(ws.send).not.toHaveBeenCalled()
  })

  it("queues WS_DATA during CONNECTING and drains on open", async () => {
    // Track messages sent to local WS
    const localWsSentMessages: { data: any; type: string }[] = []
    const eventHandlers: Record<string, Function[]> = {}

    // Mock WebSocket constructor for local WS connections
    const OriginalWebSocket = globalThis.WebSocket
    const mockLocalWs = {
      readyState: 0, // CONNECTING
      binaryType: "arraybuffer",
      send: mock((data: any) => {
        localWsSentMessages.push({ data, type: typeof data })
      }),
      close: mock(),
      addEventListener: mock((event: string, handler: any) => {
        ;(eventHandlers[event] ??= []).push(handler)
      }),
    }

    const MockWS: any = mock(function (this: any) {
      Object.assign(this, mockLocalWs)
      this.addEventListener = mockLocalWs.addEventListener
      this.send = mockLocalWs.send
      this.close = mockLocalWs.close
      Object.defineProperty(this, "readyState", {
        get: () => mockLocalWs.readyState,
        configurable: true,
      })
      return this
    })
    MockWS.OPEN = 1
    MockWS.CONNECTING = 0
    MockWS.CLOSING = 2
    MockWS.CLOSED = 3
    globalThis.WebSocket = MockWS

    const activeLocalWs = new Map<number, WebSocket>()
    const wsQueues: WsConnectQueues = new Map()

    // Send WS_UPGRADE to create local WS
    const upgradeFrame = buildWsUpgradeFrame(2, {
      url: "/ws-echo",
      headers: {},
    })
    handleBinaryFrame(
      encodeFrame(upgradeFrame),
      ws as any,
      3000,
      activeLocalWs,
      undefined,
      wsQueues
    )

    expect(MockWS).toHaveBeenCalled()
    const queue = getWsConnectQueue(2, wsQueues)
    expect(queue).toBeDefined()

    // Send WS_DATA while still CONNECTING — should queue
    const dataFrame1 = buildWsDataFrame(
      2,
      new TextEncoder().encode("msg1"),
      false
    )
    handleBinaryFrame(
      encodeFrame(dataFrame1),
      ws as any,
      3000,
      activeLocalWs,
      undefined,
      wsQueues
    )
    const dataFrame2 = buildWsDataFrame(
      2,
      new TextEncoder().encode("msg2"),
      false
    )
    handleBinaryFrame(
      encodeFrame(dataFrame2),
      ws as any,
      3000,
      activeLocalWs,
      undefined,
      wsQueues
    )

    expect(queue).toHaveLength(2)
    expect(localWsSentMessages).toHaveLength(0) // Not sent yet

    // Simulate local WS opening — fire all "open" handlers
    mockLocalWs.readyState = 1 // OPEN
    for (const handler of eventHandlers["open"] ?? []) handler()

    // Queue should have been drained
    expect(localWsSentMessages).toHaveLength(2)
    expect(localWsSentMessages[0].data).toBe("msg1")
    expect(localWsSentMessages[1].data).toBe("msg2")

    // Verify queue is cleaned up
    expect(getWsConnectQueue(2, wsQueues)).toBeUndefined()

    globalThis.WebSocket = OriginalWebSocket
  })

  it("buffers DATA frames when body exceeds high-water mark", async () => {
    // Mock fetch to consume body slowly via a ReadableStream
    const originalFetch = globalThis.fetch
    let bodyStream: ReadableStream<Uint8Array> | null = null

    globalThis.fetch = mock(async (_url: string, init: any) => {
      bodyStream = init?.body ?? null
      // Don't consume the body yet — let it buffer
      return new Response("ok", { status: 200 })
    }) as any

    const pendingBodies: PendingBodies = new Map()

    // Send HTTP_REQ for POST
    const reqFrame = buildHttpReqFrame(2, {
      method: "POST",
      url: "/upload",
      headers: { "content-type": "application/octet-stream" },
    })
    handleBinaryFrame(
      encodeFrame(reqFrame),
      ws as any,
      3000,
      undefined,
      pendingBodies
    )

    // Wait for fetch to start
    await new Promise((r) => setTimeout(r, 50))

    const sink = pendingBodies.get(2)
    expect(sink).toBeDefined()

    // Send data frames that exceed the high-water mark (4MB)
    // Build a 5MB payload and chunk it into 64KB frames
    const fullPayload = new Uint8Array(5 * 1024 * 1024)
    for (let i = 0; i < 5; i++) {
      fullPayload.fill(i + 1, i * 1024 * 1024, (i + 1) * 1024 * 1024)
    }
    const dataFrames = buildDataFrames(2, fullPayload)
    let sentBytes = 0
    for (const frame of dataFrames) {
      handleBinaryFrame(
        encodeFrame(frame),
        ws as any,
        3000,
        undefined,
        pendingBodies
      )
      sentBytes += frame.payload.byteLength
    }

    // Some chunks should be buffered (not all enqueued directly)
    // The first 4MB go direct, remaining should be buffered
    // bufferedBytes only tracks data in the buffer (not directly enqueued)
    expect(sink!.buffer.length).toBeGreaterThan(0)
    expect(sink!.bufferedBytes).toBeGreaterThan(0)
    expect(sink!.bufferedBytes).toBeLessThan(sentBytes) // not all data was buffered
    expect(sink!.finished).toBe(true)

    // Now consume the body stream — pull should drain the buffer IN ORDER
    if (bodyStream) {
      const reader = (bodyStream as ReadableStream<Uint8Array>).getReader()
      let totalBytes = 0
      const allData = new Uint8Array(sentBytes)
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        allData.set(value, totalBytes)
        totalBytes += value.byteLength
      }
      expect(totalBytes).toBe(sentBytes)

      // Verify data arrived in correct order
      // Each 1MB block should be filled with (blockIndex + 1)
      for (let i = 0; i < 5; i++) {
        const offset = i * 1024 * 1024
        const expected = i + 1
        // Check first and last byte of each block
        expect(allData[offset]).toBe(expected)
        expect(allData[offset + 1024 * 1024 - 1]).toBe(expected)
      }
    }

    // Sink should be cleaned up
    expect(pendingBodies.has(2)).toBe(false)

    globalThis.fetch = originalFetch
  })
})
