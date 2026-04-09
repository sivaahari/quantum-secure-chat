// frontend/src/hooks/useAES.ts
/**
 * Manages a MAP of CryptoKey objects, one per BB84 key version.
 *
 * Key change from v1:
 *   v1: single CryptoKey — can only decrypt messages from the CURRENT key
 *   v2: Map<version, CryptoKey> — can decrypt ANY message regardless of which
 *       key version was used to encrypt it
 *
 * decrypt(payload) looks up payload.key_version in the map, so old messages
 * always decrypt correctly even after a key refresh.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { importKeyFromHex, encryptMessage, safeDecrypt } from "@/lib/aes";
import type { EncryptedPayload } from "@/types";

export function useAES(
  keyHexMap:      Map<number, string>,   // version → hex (all known keys)
  currentVersion: number,                // which version to USE for encryption
) {
  // Map of version → imported CryptoKey
  const [cryptoKeyMap, setCryptoKeyMap] = useState<Map<number, CryptoKey>>(new Map());
  const importingRef = useRef(false);

  // ── Import any keys that are in keyHexMap but not yet in cryptoKeyMap ──────
  useEffect(() => {
    if (keyHexMap.size === 0) return;

    // Find versions that need importing
    const toImport: Array<{ version: number; hex: string }> = [];
    keyHexMap.forEach((hex, version) => {
      if (hex.length === 64 && !cryptoKeyMap.has(version)) {
        toImport.push({ version, hex });
      }
    });

    if (toImport.length === 0) return;
    if (importingRef.current) return;

    importingRef.current = true;

    Promise.all(
      toImport.map(({ version, hex }) =>
        importKeyFromHex(hex).then((key) => ({ version, key }))
      )
    )
      .then((results) => {
        setCryptoKeyMap((prev) => {
          const next = new Map(prev);
          results.forEach(({ version, key }) => next.set(version, key));
          return next;
        });
      })
      .catch((err) => {
        console.error("[useAES] Key import error:", err);
      })
      .finally(() => {
        importingRef.current = false;
      });
  }, [keyHexMap]); // re-run whenever keyHexMap changes (new keys added)

  // ── Encrypt using the CURRENT version ─────────────────────────────────────
  const encrypt = useCallback(
    async (plaintext: string): Promise<EncryptedPayload | null> => {
      const key = cryptoKeyMap.get(currentVersion);
      if (!key) {
        console.warn("[useAES] No CryptoKey for version", currentVersion);
        return null;
      }
      try {
        return await encryptMessage(key, plaintext, currentVersion);
      } catch (err) {
        console.error("[useAES] Encrypt error:", err);
        return null;
      }
    },
    [cryptoKeyMap, currentVersion]
  );

  // ── Decrypt using the VERSION stored in the payload ────────────────────────
  // This is the core fix: we look up the right key by payload.key_version,
  // not by currentVersion. So a message from key v1 decrypts even after
  // the room has moved to key v2 or v3.
  const decrypt = useCallback(
    async (payload: EncryptedPayload): Promise<string> => {
      const key = cryptoKeyMap.get(payload.key_version) ?? null;

      if (!key) {
        // Key not yet imported or version unknown
        const knownVersions = Array.from(cryptoKeyMap.keys()).join(", ");
        return (
          `⚠ No key for version v${payload.key_version}. ` +
          `Known: [${knownVersions || "none"}]. ` +
          "Rejoin the room to load key history."
        );
      }

      const { text, error } = await safeDecrypt(key, payload);
      return text ?? error ?? "⚠ Decryption failed";
    },
    [cryptoKeyMap]
  );

  return {
    cryptoKeyMap,
    encrypt,
    decrypt,
    ready:         cryptoKeyMap.has(currentVersion),
    knownVersions: Array.from(cryptoKeyMap.keys()),
  };
}