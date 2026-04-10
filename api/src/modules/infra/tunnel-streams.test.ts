import {
  Flags,
  FrameType,
  PROTOCOL_VERSION,
  buildDataFrame,
  buildHttpResFrame,
  buildWsCloseFrame,
  buildWsDataFrame,
  encodeFrame,
} from "@smp/factory-shared/tunnel-protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { StreamManager } from "./tunnel-streams"

/** Consume a ReadableStream into a single Uint8Array. */
async function readAll(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

describe("StreamManager", () => {
  let sm: StreamManager
  const mockSend = vi.fn()

  beforeEach(() => {
    mockSend.mockReset()
    sm = new StreamManager(mockSend)
  })

  it("allocates even stream IDs starting at 2", () => {
    const id1 = sm.nextStreamId()
    const id2 = sm.nextStreamId()
    expect(id1).toBe(2)
    expect(id2).toBe(4)
    expect(id1 % 2).toBe(0)
    expect(id2 % 2).toBe(0)
  })

  it("sendHttpRequest sends HTTP_REQ frame and returns a streaming response", async () => {
    const promise = sm.sendHttpRequest({
      method: "GET",
      url: "/health",
      headers: { host: "test.tunnel.dx.dev" },
    })

    // HTTP_REQ + empty FIN DATA (signals no request body)
    expect(mockSend).toHaveBeenCalledTimes(2)
    const sentBuf = mockSend.mock.calls[0][0] as Uint8Array
    expect(sentBuf[1]).toBe(FrameType.HTTP_REQ)
    // Second frame is an empty FIN DATA
    const finBuf = mockSend.mock.calls[1][0] as Uint8Array
    expect(finBuf[1]).toBe(FrameType.DATA)

    // Simulate response
    sm.handleFrame({
      version: PROTOCOL_VERSION,
      type: FrameType.HTTP_RES,
      streamId: 2,
      flags: Flags.NONE,
      payload: new TextEncoder().encode(
        JSON.stringify({
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      ),
    })
    sm.handleFrame({
      version: PROTOCOL_VERSION,
      type: FrameType.DATA,
      streamId: 2,
      flags: Flags.FIN,
      payload: new TextEncoder().encode("OK"),
    })

    const res = await promise
    expect(res.status).toBe(200)
    const body = await readAll(res.body)
    expect(new TextDecoder().decode(body)).toBe("OK")
  })

  it("times out pending requests", async () => {
    vi.useFakeTimers()
    const promise = sm.sendHttpRequest(
      { method: "GET", url: "/slow", headers: {} },
      { timeoutMs: 100 }
    )
    vi.advanceTimersByTime(150)
    await expect(promise).rejects.toThrow("timed out")
    vi.useRealTimers()
  })

  it("handleFrame with RST_STREAM rejects the pending request", async () => {
    const promise = sm.sendHttpRequest({
      method: "GET",
      url: "/fail",
      headers: {},
    })

    sm.handleFrame({
      version: PROTOCOL_VERSION,
      type: FrameType.RST_STREAM,
      streamId: 2,
      flags: Flags.RST,
      payload: new Uint8Array(0),
    })

    await expect(promise).rejects.toThrow("reset")
  })

  it("streams multi-chunk DATA frames", async () => {
    const promise = sm.sendHttpRequest({
      method: "GET",
      url: "/big",
      headers: {},
    })

    sm.handleFrame(buildHttpResFrame(2, { status: 200, headers: {} }))
    sm.handleFrame(buildDataFrame(2, new TextEncoder().encode("chunk1"), false))
    sm.handleFrame(buildDataFrame(2, new TextEncoder().encode("chunk2"), true))

    const res = await promise
    const body = await readAll(res.body)
    expect(new TextDecoder().decode(body)).toBe("chunk1chunk2")
  })

  it("cleanup cancels all pending streams", async () => {
    const p1 = sm.sendHttpRequest({ method: "GET", url: "/a", headers: {} })
    const p2 = sm.sendHttpRequest({ method: "GET", url: "/b", headers: {} })
    sm.cleanup()
    await expect(p1).rejects.toThrow("closed")
    await expect(p2).rejects.toThrow("closed")
  })

  it("rejects when concurrent stream limit is exceeded", async () => {
    const sm2 = new StreamManager(mockSend, { maxConcurrentStreams: 2 })
    // Fill up 2 streams (catch cleanup rejections)
    const p1 = sm2
      .sendHttpRequest({ method: "GET", url: "/a", headers: {} })
      .catch(() => {})
    const p2 = sm2
      .sendHttpRequest({ method: "GET", url: "/b", headers: {} })
      .catch(() => {})
    // Third should fail
    await expect(
      sm2.sendHttpRequest({ method: "GET", url: "/c", headers: {} })
    ).rejects.toThrow("Too many concurrent streams")
    sm2.cleanup()
    await p1
    await p2
  })

  it("wraps stream IDs at u32 boundary", () => {
    // Force nextId near overflow
    ;(sm as any).nextId = 0xfffffffe
    const id1 = sm.nextStreamId()
    expect(id1).toBe(0xfffffffe)
    // Next should wrap to 2
    const id2 = sm.nextStreamId()
    expect(id2).toBe(2)
  })

  it("skips in-flight stream IDs on wrap-around", async () => {
    // Start a request to occupy stream 2
    const p = sm
      .sendHttpRequest({ method: "GET", url: "/a", headers: {} })
      .catch(() => {})

    // Force nextId to wrap back to 2
    ;(sm as any).nextId = 0xfffffffe
    const wrappedId = sm.nextStreamId() // should get 0xfffffffe
    expect(wrappedId).toBe(0xfffffffe)

    // Next call should skip 2 (occupied) and return 4
    const nextId = sm.nextStreamId()
    expect(nextId).toBe(4)

    sm.cleanup()
    await p
  })

  it("skips WS handler stream IDs in nextStreamId", () => {
    sm.registerWsStream(2, { onMessage() {}, onClose() {} })

    // nextId starts at 2, should skip it
    const id = sm.nextStreamId()
    expect(id).toBe(4)

    sm.unregisterWsStream(2)
  })

  it("sends empty FIN DATA when no body is provided", () => {
    sm.sendHttpRequest({ method: "POST", url: "/logout", headers: {} }).catch(
      () => {}
    )

    // Should have sent HTTP_REQ + empty FIN DATA
    expect(mockSend).toHaveBeenCalledTimes(2)
    const reqBuf = mockSend.mock.calls[0][0] as Uint8Array
    expect(reqBuf[1]).toBe(FrameType.HTTP_REQ)

    const dataBuf = mockSend.mock.calls[1][0] as Uint8Array
    expect(dataBuf[1]).toBe(FrameType.DATA)
    expect(dataBuf[6] & Flags.FIN).toBeTruthy() // FIN flag set

    sm.cleanup()
  })

  it("dispatches WS_DATA to per-stream handlers (concurrent WS connections)", () => {
    const stream2Messages: { data: Uint8Array; isBinary: boolean }[] = []
    const stream4Messages: { data: Uint8Array; isBinary: boolean }[] = []

    sm.registerWsStream(2, {
      onMessage(_sid, data, isBinary) {
        stream2Messages.push({ data, isBinary })
      },
      onClose() {},
    })
    sm.registerWsStream(4, {
      onMessage(_sid, data, isBinary) {
        stream4Messages.push({ data, isBinary })
      },
      onClose() {},
    })

    // Send WS_DATA for stream 2 (text)
    sm.handleFrame(
      buildWsDataFrame(2, new TextEncoder().encode("hello"), false)
    )
    // Send WS_DATA for stream 4 (binary)
    sm.handleFrame(buildWsDataFrame(4, new Uint8Array([1, 2, 3]), true))
    // Send another for stream 2
    sm.handleFrame(
      buildWsDataFrame(2, new TextEncoder().encode("world"), false)
    )

    expect(stream2Messages).toHaveLength(2)
    expect(new TextDecoder().decode(stream2Messages[0].data)).toBe("hello")
    expect(stream2Messages[0].isBinary).toBe(false)
    expect(new TextDecoder().decode(stream2Messages[1].data)).toBe("world")

    expect(stream4Messages).toHaveLength(1)
    expect(stream4Messages[0].data).toEqual(new Uint8Array([1, 2, 3]))
    expect(stream4Messages[0].isBinary).toBe(true)
  })

  it("dispatches WS_CLOSE to the correct per-stream handler", () => {
    const closed: number[] = []

    sm.registerWsStream(2, {
      onMessage() {},
      onClose(sid) {
        closed.push(sid)
      },
    })
    sm.registerWsStream(4, {
      onMessage() {},
      onClose(sid) {
        closed.push(sid)
      },
    })

    sm.handleFrame(buildWsCloseFrame(4))

    expect(closed).toEqual([4])
  })

  it("unregisterWsStream stops dispatching to that stream", () => {
    const messages: string[] = []

    sm.registerWsStream(2, {
      onMessage(_sid, data) {
        messages.push(new TextDecoder().decode(data))
      },
      onClose() {},
    })

    sm.handleFrame(
      buildWsDataFrame(2, new TextEncoder().encode("before"), false)
    )
    sm.unregisterWsStream(2)
    sm.handleFrame(
      buildWsDataFrame(2, new TextEncoder().encode("after"), false)
    )

    expect(messages).toEqual(["before"])
  })

  it("cleanup clears all WS handlers", () => {
    const messages: string[] = []

    sm.registerWsStream(2, {
      onMessage(_sid, data) {
        messages.push(new TextDecoder().decode(data))
      },
      onClose() {},
    })

    sm.cleanup()
    sm.handleFrame(
      buildWsDataFrame(2, new TextEncoder().encode("after-cleanup"), false)
    )

    expect(messages).toEqual([])
  })

  it("body stream times out when no DATA arrives after HTTP_RES", async () => {
    vi.useFakeTimers()
    const sm2 = new StreamManager(mockSend, { bodyTimeoutMs: 200 })
    const promise = sm2.sendHttpRequest({
      method: "GET",
      url: "/stall",
      headers: {},
    })

    // Send HTTP_RES but never send DATA
    sm2.handleFrame(buildHttpResFrame(2, { status: 200, headers: {} }))

    const res = await promise
    const reader = res.body.getReader()

    // Advance past body timeout
    vi.advanceTimersByTime(250)

    await expect(reader.read()).rejects.toThrow("body timed out")
    vi.useRealTimers()
  })

  it("body timer resets on each DATA frame", async () => {
    vi.useFakeTimers()
    const sm2 = new StreamManager(mockSend, { bodyTimeoutMs: 200 })
    const promise = sm2.sendHttpRequest({
      method: "GET",
      url: "/slow-stream",
      headers: {},
    })

    sm2.handleFrame(buildHttpResFrame(2, { status: 200, headers: {} }))
    const res = await promise

    // Advance 150ms (under timeout), send DATA
    vi.advanceTimersByTime(150)
    sm2.handleFrame(
      buildDataFrame(2, new TextEncoder().encode("chunk1"), false)
    )

    // Advance another 150ms (under reset timeout), send FIN
    vi.advanceTimersByTime(150)
    sm2.handleFrame(buildDataFrame(2, new TextEncoder().encode("chunk2"), true))

    // Body should complete normally
    const body = await readAll(res.body)
    expect(new TextDecoder().decode(body)).toBe("chunk1chunk2")
    vi.useRealTimers()
  })

  it("cleanup cancels active body readers", async () => {
    let readCount = 0
    const slowBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        readCount++
        if (readCount > 10) {
          controller.close()
          return
        }
        // Simulate slow producer
        await new Promise((r) => setTimeout(r, 10))
        controller.enqueue(new TextEncoder().encode("data"))
      },
    })

    const promise = sm
      .sendHttpRequest(
        { method: "POST", url: "/upload", headers: {} },
        { body: slowBody }
      )
      .catch(() => {})

    // Let first read start
    await new Promise((r) => setTimeout(r, 30))
    const readsBeforeCleanup = readCount

    // Cleanup should cancel the reader
    sm.cleanup()

    // Wait to confirm no more reads happen
    await new Promise((r) => setTimeout(r, 100))
    // readCount should not have grown much beyond what it was at cleanup
    expect(readCount).toBeLessThanOrEqual(readsBeforeCleanup + 1)

    await promise
  })
})
