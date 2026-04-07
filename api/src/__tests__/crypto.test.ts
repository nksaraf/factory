import { describe, expect, it, afterEach } from "vitest";
import { encrypt, decrypt } from "../lib/secrets/crypto";

describe("secrets/crypto", () => {
  // Save and restore env vars
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("encrypt/decrypt roundtrip", () => {
    it("encrypts and decrypts a simple string", () => {
      const plaintext = "hello-world-secret";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("encrypts and decrypts strings with special characters", () => {
      const plaintext = 'p@$$w0rd!#%^&*()_+-={}[]|\\:";\'<>?,./\n\ttabs';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("encrypts and decrypts empty string", () => {
      const encrypted = encrypt("");
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe("");
    });

    it("encrypts and decrypts long string", () => {
      const plaintext = "x".repeat(10000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("produces different ciphertext for same plaintext (random IV)", () => {
      const plaintext = "same-input";
      const a = encrypt(plaintext);
      const b = encrypt(plaintext);
      expect(a.ciphertext).not.toBe(b.ciphertext);
      expect(a.iv).not.toBe(b.iv);
    });
  });

  describe("key versioning", () => {
    it("defaults to keyVersion 1", () => {
      const encrypted = encrypt("test");
      expect(encrypted.keyVersion).toBe(1);
    });

    it("accepts explicit keyVersion", () => {
      const encrypted = encrypt("test", 1);
      expect(encrypted.keyVersion).toBe(1);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe("test");
    });

    it("falls back to v1 key when versioned key env var is missing", () => {
      // keyVersion 5 has no env var set, should fall back to v1
      const encrypted = encrypt("fallback-test", 5);
      expect(encrypted.keyVersion).toBe(5);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe("fallback-test");
    });

    it("uses versioned key when env var is set", () => {
      // Set a different key for version 2
      process.env.FACTORY_SECRET_MASTER_KEY_V2 =
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      const encrypted = encrypt("v2-test", 2);
      expect(encrypted.keyVersion).toBe(2);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe("v2-test");
    });

    it("fails to decrypt with wrong key version", () => {
      // Encrypt with v1
      const encrypted = encrypt("secret", 1);
      // Set a DIFFERENT key for v2
      process.env.FACTORY_SECRET_MASTER_KEY_V2 =
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      // Try to decrypt claiming it was v2 — should fail
      expect(() => decrypt({ ...encrypted, keyVersion: 2 })).toThrow();
    });
  });

  describe("payload format", () => {
    it("returns base64-encoded fields", () => {
      const encrypted = encrypt("test");
      // All fields should be valid base64
      expect(() => Buffer.from(encrypted.ciphertext, "base64")).not.toThrow();
      expect(() => Buffer.from(encrypted.iv, "base64")).not.toThrow();
      expect(() => Buffer.from(encrypted.authTag, "base64")).not.toThrow();
    });

    it("IV is 12 bytes (GCM standard)", () => {
      const encrypted = encrypt("test");
      const iv = Buffer.from(encrypted.iv, "base64");
      expect(iv.length).toBe(12);
    });

    it("auth tag is 16 bytes", () => {
      const encrypted = encrypt("test");
      const tag = Buffer.from(encrypted.authTag, "base64");
      expect(tag.length).toBe(16);
    });
  });
});
