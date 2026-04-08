// frontend/src/lib/aes.ts
/**
 * Browser-side AES-256-GCM encryption using the Web Crypto API.
 *
 * MUST be compatible with the Python backend's AESCipher:
 *   - 32-byte key (256 bits)
 *   - 12-byte random nonce (96 bits)
 *   - 128-bit authentication tag (appended to ciphertext by both sides)
 *   - Associated data: UTF-8 bytes of "quantum-llm-chat"
 *
 * The Web Crypto AES-GCM format (ciphertext || tag) is the same as
 * Python's cryptography.hazmat.primitives.ciphers.aead.AESGCM output.
 */

import type { EncryptedPayload } from "@/types";
import { hexToBytes, base64ToBytes, bytesToBase64 } from "@/lib/utils";

const ALGO           = "AES-GCM";
const NONCE_BYTES    = 12;       // 96-bit nonce
const TAG_LENGTH     = 128;      // bits — 16-byte auth tag
const AAD_BYTES      = new TextEncoder().encode("quantum-llm-chat");

// ─────────────────────────────────────────────────────────────────────────────
// Key import
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Import a 32-byte AES-256 key from its hex representation.
 * Returns a non-extractable CryptoKey usable for encrypt + decrypt.
 */
export async function importKeyFromHex(hexKey: string): Promise<CryptoKey> {
  if (!hexKey || hexKey.length !== 64) {
    throw new Error(
      `AES key must be 64 hex chars (32 bytes); got ${hexKey?.length ?? 0}`
    );
  }
  const keyBytes = hexToBytes(hexKey);
  return crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: ALGO, length: 256 },
    false,               // non-extractable (security best-practice)
    ["encrypt", "decrypt"]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Encryption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Generates a fresh random nonce for every call.
 */
export async function encryptMessage(
  key:        CryptoKey,
  plaintext:  string,
  keyVersion: number = 0
): Promise<EncryptedPayload> {
  const nonce       = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const encoded     = new TextEncoder().encode(plaintext);

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: ALGO, iv: nonce as BufferSource, tagLength: TAG_LENGTH, additionalData: AAD_BYTES },
    key,
    encoded
  );

  return {
    nonce_b64:      bytesToBase64(nonce),
    ciphertext_b64: bytesToBase64(new Uint8Array(ciphertextBuf)),
    timestamp:      Date.now() / 1000,
    key_version:    keyVersion,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Decryption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decrypt an EncryptedPayload using AES-256-GCM.
 * Throws DOMException if authentication fails (tampered ciphertext).
 */
export async function decryptMessage(
  key:     CryptoKey,
  payload: EncryptedPayload
): Promise<string> {
  const nonce      = base64ToBytes(payload.nonce_b64);
  const ciphertext = base64ToBytes(payload.ciphertext_b64);

  const plaintextBuf = await crypto.subtle.decrypt(
    { name: ALGO, iv: nonce as BufferSource, tagLength: TAG_LENGTH, additionalData: AAD_BYTES },
    key,
    ciphertext.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(plaintextBuf);
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe wrapper — never throws to the caller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempt decryption; return { text, error } instead of throwing.
 * Used by MessageBubble to safely display decrypted content.
 */
export async function safeDecrypt(
  key:     CryptoKey | null,
  payload: EncryptedPayload
): Promise<{ text: string | null; error: string | null }> {
  if (!key) {
    return { text: null, error: "No AES key loaded. Generate a quantum key first." };
  }
  try {
    const text = await decryptMessage(key, payload);
    return { text, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("operation-specific") || msg.toLowerCase().includes("tag")) {
      return { text: null, error: "⚠ Authentication failed — message may be tampered." };
    }
    return { text: null, error: `Decryption error: ${msg}` };
  }
}