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
    const body = JSON.parse(new TextDecoder().decode(await readAll(res.body)));
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

    expect(new TextDecoder().decode(await readAll(res1.body))).toBe("response-for-/a");
    expect(new TextDecoder().decode(await readAll(res2.body))).toBe("response-for-/b");
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
