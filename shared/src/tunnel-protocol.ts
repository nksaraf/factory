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
