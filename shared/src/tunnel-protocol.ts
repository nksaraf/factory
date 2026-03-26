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

/**
 * Send data as one or more DATA frames, chunking at MAX_PAYLOAD_SIZE.
 * The last chunk gets the FIN flag.
 */
export function buildDataFrames(
  streamId: number,
  data: Uint8Array
): Frame[] {
  if (data.byteLength === 0) {
    return [buildDataFrame(streamId, new Uint8Array(0), true)];
  }

  const frames: Frame[] = [];
  let offset = 0;
  while (offset < data.byteLength) {
    const end = Math.min(offset + MAX_PAYLOAD_SIZE, data.byteLength);
    const chunk = data.slice(offset, end);
    const isFin = end >= data.byteLength;
    frames.push(buildDataFrame(streamId, chunk, isFin));
    offset = end;
  }
  return frames;
}
