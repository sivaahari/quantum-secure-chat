// frontend/src/hooks/useAES.ts
/**
 * Manages a MAP of CryptoKey objects, one per BB84 key version.
 *
 * Critical fix (v4):
 *  - keyHexMapRef is updated SYNCHRONOUSLY during render (not in useEffect).
 *    This ensures importKeyOnDemand always sees the latest hex map even when
 *    called immediately after state updates (e.g. during room_joined handling).
 *  - Exports a `keyCount` number so MessageBubble can re-trigger decryption
 *    when new keys become available (retry mechanism).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { importKeyFromHex, encryptMessage, safeDecrypt } from "@/lib/aes";
import type { EncryptedPayload } from "@/types";

export function useAES(
  keyHexMap:      Map<number, string>,
  currentVersion: number,
) {
  const [cryptoKeyMap, setCryptoKeyMap] = useState<Map<number, CryptoKey>>(new Map());

  // ── SYNCHRONOUS ref update (not in useEffect) ─────────────────────────────
  // By assigning during render (before any child useEffects run), we guarantee
  // importKeyOnDemand always reads the current hex map even if called
  // immediately in the same render cycle that added new keys.
  const keyHexMapRef     = useRef<Map<number, string>>(keyHexMap);
  keyHexMapRef.current   = keyHexMap;   // ← sync, every render

  const cryptoKeyMapRef  = useRef<Map<number, CryptoKey>>(cryptoKeyMap);
  cryptoKeyMapRef.current = cryptoKeyMap; // ← sync, every render

  const inProgressRef    = useRef<Set<number>>(new Set());

  // ── Background batch import ───────────────────────────────────────────────
  useEffect(() => {
    const toImport: Array<{ version: number; hex: string }> = [];

    keyHexMap.forEach((hex, version) => {
      if (
        hex.length === 64 &&
        !cryptoKeyMap.has(version) &&
        !inProgressRef.current.has(version)
      ) {
        toImport.push({ version, hex });
      }
    });

    if (toImport.length === 0) return;

    toImport.forEach(({ version }) => inProgressRef.current.add(version));

    Promise.all(
      toImport.map(({ version, hex }) =>
        importKeyFromHex(hex)
          .then((key) => ({ version, key }))
          .catch((err) => {
            console.error(`[useAES] batch import failed v${version}:`, err);
            inProgressRef.current.delete(version);
            return null;
          })
      )
    ).then((results) => {
      const valid = results.filter(Boolean) as Array<{ version: number; key: CryptoKey }>;
      if (valid.length === 0) return;

      setCryptoKeyMap((prev) => {
        const next = new Map(prev);
        valid.forEach(({ version, key }) => {
          next.set(version, key);
          inProgressRef.current.delete(version);
        });
        return next;
      });
    });
  }); // intentionally no dep array — idempotent, guarded by inProgressRef

  // ── On-demand import (called from decrypt when key not in map yet) ─────────
  const importKeyOnDemand = useCallback(async (version: number): Promise<CryptoKey | null> => {
    // Already imported (check live ref, not stale closure)
    const existing = cryptoKeyMapRef.current.get(version);
    if (existing) return existing;

    // Have the hex? (check live ref — updated synchronously above)
    const hex = keyHexMapRef.current.get(version);
    if (!hex || hex.length !== 64) {
      console.warn(`[useAES] No hex for v${version}. Available:`, [...keyHexMapRef.current.keys()]);
      return null;
    }

    try {
      const key = await importKeyFromHex(hex);
      // Persist into state and live ref immediately
      setCryptoKeyMap((prev) => {
        const next = new Map(prev);
        next.set(version, key);
        return next;
      });
      cryptoKeyMapRef.current.set(version, key);
      return key;
    } catch (err) {
      console.error(`[useAES] on-demand import failed v${version}:`, err);
      return null;
    }
  }, []);

  // ── Encrypt ───────────────────────────────────────────────────────────────
  const encrypt = useCallback(async (plaintext: string): Promise<EncryptedPayload | null> => {
    let key = cryptoKeyMapRef.current.get(currentVersion) ?? null;
    if (!key) key = await importKeyOnDemand(currentVersion);
    if (!key) {
      console.warn("[useAES] encrypt: no key for v", currentVersion);
      return null;
    }
    try {
      return await encryptMessage(key, plaintext, currentVersion);
    } catch (err) {
      console.error("[useAES] encrypt error:", err);
      return null;
    }
  }, [currentVersion, importKeyOnDemand]);

  // ── Decrypt ───────────────────────────────────────────────────────────────
  const decrypt = useCallback(async (payload: EncryptedPayload): Promise<string> => {
    const ver = payload.key_version;

    let key = cryptoKeyMapRef.current.get(ver) ?? null;
    if (!key) key = await importKeyOnDemand(ver);

    if (!key) {
      const known  = [...cryptoKeyMapRef.current.keys()].join(", ");
      const hasHex = keyHexMapRef.current.has(ver);
      console.warn(`[useAES] decrypt: no key v${ver}. known=[${known}] hasHex=${hasHex}`);
      return (
        `⚠ No key for v${ver}. ` +
        (hasHex
          ? "Import failed — check console."
          : `Known: [${known || "none"}]. Rejoin to load history.`)
      );
    }

    const { text, error } = await safeDecrypt(key, payload);
    return text ?? error ?? "⚠ Decryption failed";
  }, [importKeyOnDemand]);

  return {
    cryptoKeyMap,
    encrypt,
    decrypt,
    // keyCount changes whenever a new key is imported → MessageBubble uses
    // this as a dependency to retry failed decryptions automatically
    keyCount: cryptoKeyMap.size,
    ready:    cryptoKeyMap.has(currentVersion),
    knownVersions: [...cryptoKeyMap.keys()],
  };
}