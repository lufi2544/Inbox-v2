import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM encryption for sensitive values stored in the database.
// Requires TOKEN_ENCRYPTION_KEY env var: a 64-char hex string (32 bytes).
// Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// If TOKEN_ENCRYPTION_KEY is not set, values are stored plaintext with a warning.
// This allows local dev without the key, but production MUST have it set.

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) return null;
  if (hex.length !== 64) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes).");
  }
  return Buffer.from(hex, "hex");
}

// Returns encrypted string as "iv:authTag:ciphertext" (all hex).
// Falls back to plaintext prefixed with "plain:" if no key is set.
export function encrypt(text) {
  const key = getKey();
  if (!key) {
    console.warn("[encrypt] TOKEN_ENCRYPTION_KEY not set — storing token as plaintext.");
    return `plain:${text}`;
  }
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

// Decrypts a value produced by encrypt().
// Handles both "enc:..." and legacy plaintext "plain:..." values.
export function decrypt(stored) {
  if (!stored) return stored;
  if (stored.startsWith("plain:")) return stored.slice(6);

  const key = getKey();
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required to decrypt stored tokens.");
  }

  const parts = stored.split(":");
  if (parts[0] !== "enc" || parts.length !== 4) {
    // Unrecognised format — assume legacy plaintext (pre-encryption migration)
    return stored;
  }

  const [, ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
