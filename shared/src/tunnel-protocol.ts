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
