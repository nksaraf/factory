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
