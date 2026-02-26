import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt, generateEncryptionKey } from "../crypto";

describe("crypto utils", () => {
  beforeAll(() => {
    // Set test encryption key (32 bytes = 64 hex chars)
    process.env.ENCRYPTION_KEY = "a".repeat(64);
  });

  it("encrypts and decrypts a string roundtrip", () => {
    const plaintext = "ghp_abc123secrettoken";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":"); // iv:authTag:ciphertext format
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const plaintext = "same-input";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    parts[2] = "tampered" + parts[2];
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("throws if ENCRYPTION_KEY is not set", () => {
    const original = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY");
    process.env.ENCRYPTION_KEY = original;
  });

  it("generateEncryptionKey returns 64-char hex string", () => {
    const key = generateEncryptionKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
  });
});
