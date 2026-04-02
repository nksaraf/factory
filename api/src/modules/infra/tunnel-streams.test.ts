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

/** Consume a ReadableStream into a single Uint8Array. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

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

  it("sendHttpRequest sends HTTP_REQ frame and returns a streaming response", async () => {
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
    const body = await readAll(res.body);
    expect(new TextDecoder().decode(body)).toBe("OK");
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

  it("streams multi-chunk DATA frames", async () => {
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
    const body = await readAll(res.body);
    expect(new TextDecoder().decode(body)).toBe("chunk1chunk2");
  });

  it("cleanup cancels all pending streams", async () => {
    const p1 = sm.sendHttpRequest({ method: "GET", url: "/a", headers: {} });
    const p2 = sm.sendHttpRequest({ method: "GET", url: "/b", headers: {} });
    sm.cleanup();
    await expect(p1).rejects.toThrow("closed");
    await expect(p2).rejects.toThrow("closed");
  });

  it("rejects when concurrent stream limit is exceeded", async () => {
    const sm2 = new StreamManager(mockSend, { maxConcurrentStreams: 2 });
    // Fill up 2 streams (catch cleanup rejections)
    const p1 = sm2.sendHttpRequest({ method: "GET", url: "/a", headers: {} }).catch(() => {});
    const p2 = sm2.sendHttpRequest({ method: "GET", url: "/b", headers: {} }).catch(() => {});
    // Third should fail
    await expect(
      sm2.sendHttpRequest({ method: "GET", url: "/c", headers: {} })
    ).rejects.toThrow("Too many concurrent streams");
    sm2.cleanup();
    await p1;
    await p2;
  });

  it("wraps stream IDs at u32 boundary", () => {
    // Force nextId near overflow
    (sm as any).nextId = 0xfffffffe;
    const id1 = sm.nextStreamId();
    expect(id1).toBe(0xfffffffe);
    // Next should wrap to 2
    const id2 = sm.nextStreamId();
    expect(id2).toBe(2);
  });
});
