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
    ) as any;

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

    // Should have sent HTTP_RES + DATA frame(s) + FIN frame
    expect(ws.send.mock.calls.length).toBeGreaterThanOrEqual(2);

    const resFrame = decodeFrame(ws.send.mock.calls[0][0] as Uint8Array);
    expect(resFrame.type).toBe(FrameType.HTTP_RES);
    expect(resFrame.streamId).toBe(2);

    // Collect all DATA frames and concatenate body
    const dataFrames = ws.send.mock.calls
      .slice(1)
      .map((call: any) => decodeFrame(call[0] as Uint8Array))
      .filter((f: any) => f.type === FrameType.DATA);

    const bodyParts: Uint8Array[] = [];
    let hasFin = false;
    for (const df of dataFrames) {
      if (df.payload.byteLength > 0) bodyParts.push(df.payload);
      if (df.flags & Flags.FIN) hasFin = true;
    }
    expect(hasFin).toBe(true);
    const totalLen = bodyParts.reduce((s: number, c: Uint8Array) => s + c.byteLength, 0);
    const body = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of bodyParts) {
      body.set(part, offset);
      offset += part.byteLength;
    }
    expect(new TextDecoder().decode(body)).toBe("hello from local");

    globalThis.fetch = originalFetch;
  });

  it("sends RST_STREAM when localhost is unreachable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

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
