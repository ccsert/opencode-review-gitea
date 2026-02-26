import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY environment variable must be a 64-character hex string (32 bytes). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns format: `iv:authTag:ciphertext` (all hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt ciphertext produced by encrypt().
 */
export function decrypt(encryptedText: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertext] = encryptedText.split(":");

  if (!ivHex || !authTagHex || !ciphertext) {
    throw new Error(
      "Invalid encrypted text format. Expected iv:authTag:ciphertext",
    );
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Check if a string looks like it was encrypted by our encrypt().
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  return (
    parts.length === 3 &&
    parts[0].length === IV_LENGTH * 2 &&
    parts[1].length === AUTH_TAG_LENGTH * 2
  );
}

/**
 * Generate a random encryption key (for setup/docs).
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}
