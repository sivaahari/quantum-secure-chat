// frontend/src/hooks/useAES.ts
/**
 * Manages a live CryptoKey derived from the BB84 hex key.
 * Re-imports whenever the key hex changes.
 */

import { useState, useEffect, useCallback } from "react";
import { importKeyFromHex, encryptMessage, safeDecrypt } from "@/lib/aes";
import type { EncryptedPayload } from "@/types";

export function useAES(keyHex: string, keyVersion: number) {
  const [cryptoKey, setCryptoKey]   = useState<CryptoKey | null>(null);
  const [importing, setImporting]   = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Re-import whenever keyHex changes
  useEffect(() => {
    if (!keyHex || keyHex.length !== 64) {
      setCryptoKey(null);
      return;
    }

    setImporting(true);
    setImportError(null);

    importKeyFromHex(keyHex)
      .then((key) => {
        setCryptoKey(key);
        setImporting(false);
      })
      .catch((err) => {
        setImportError(err.message);
        setCryptoKey(null);
        setImporting(false);
      });
  }, [keyHex]);

  // ── Encrypt a plaintext string ─────────────────────────────────────────────
  const encrypt = useCallback(
    async (plaintext: string): Promise<EncryptedPayload | null> => {
      if (!cryptoKey) return null;
      try {
        return await encryptMessage(cryptoKey, plaintext, keyVersion);
      } catch {
        return null;
      }
    },
    [cryptoKey, keyVersion]
  );

  // ── Decrypt an EncryptedPayload ────────────────────────────────────────────
  const decrypt = useCallback(
    async (payload: EncryptedPayload): Promise<string> => {
      const { text, error } = await safeDecrypt(cryptoKey, payload);
      return text ?? error ?? "⚠ Decryption failed";
    },
    [cryptoKey]
  );

  return {
    cryptoKey,
    importing,
    importError,
    encrypt,
    decrypt,
    ready: cryptoKey !== null,
  };
}