// frontend/src/hooks/useQuantumKey.ts
/**
 * Manages quantum key state: current key, ALL historical key versions,
 * and provides functions to import key history from room_joined events.
 *
 * Key change from v1:
 *   keyHexMap: Map<version, hex>  ← stores every key we've ever seen
 *   importKeyHistory()            ← loads all keys from room_joined payload
 */

import { useState, useCallback } from "react";
import type { KeyInfo, BB84Stats } from "@/types";
import { generateQuantumKey } from "@/lib/api";
import { toast } from "sonner";

export interface QuantumKeyState {
  keyInfo:     KeyInfo | null;
  bb84Stats:   BB84Stats | null;
  keyHex:      string;                   // current key hex
  keyHexMap:   Map<number, string>;      // version → hex (ALL versions)
  generating:  boolean;
  error:       string | null;
}

export function useQuantumKey(roomId: string) {
  const [state, setState] = useState<QuantumKeyState>({
    keyInfo:    null,
    bb84Stats:  null,
    keyHex:     "",
    keyHexMap:  new Map(),
    generating: false,
    error:      null,
  });

  // ── Generate a fresh key via BB84 ─────────────────────────────────────────

  const generate = useCallback(
    async (opts?: {
      numQubits?:     number;
      noiseEnabled?:  boolean;
      depolarProb?:   number;
      eavesdropProb?: number;
    }) => {
      setState((s) => ({ ...s, generating: true, error: null }));

      try {
        const result = await generateQuantumKey({
          room_id:        roomId,
          num_qubits:     opts?.numQubits    ?? 256,
          noise_enabled:  opts?.noiseEnabled ?? true,
          depolar_prob:   opts?.depolarProb  ?? 0.02,
          eavesdrop_prob: opts?.eavesdropProb ?? 0.0,
        });

        const newVersion = result.key_info.key_version;
        const newHex     = result.key_info.key_hex;

        setState((s) => {
          const updatedMap = new Map(s.keyHexMap);
          updatedMap.set(newVersion, newHex);
          return {
            keyInfo:    result.key_info,
            bb84Stats:  result.bb84,
            keyHex:     newHex,
            keyHexMap:  updatedMap,
            generating: false,
            error:      null,
          };
        });

        toast.success(
          `🔑 Quantum key v${newVersion} generated — ` +
          `QBER: ${(result.bb84.qber * 100).toFixed(2)}%`
        );

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, generating: false, error: msg }));
        toast.error(`Key generation failed: ${msg}`);
        return null;
      }
    },
    [roomId]
  );

  // ── Load a full key history from room_joined or key_refreshed event ────────
  // This is the fix for "messages only decrypt on the machine that sent them".
  // When you rejoin a room, the server sends all key versions it knows about.
  // We store ALL of them in keyHexMap so MessageBubble can decrypt any message.

  const importKeyHistory = useCallback((keyHistory: KeyInfo[]) => {
    if (!keyHistory || keyHistory.length === 0) return;

    setState((s) => {
      const updatedMap = new Map(s.keyHexMap);

      // Add every version from the history array to our map
      for (const ki of keyHistory) {
        if (ki.key_hex && ki.key_hex.length === 64) {
          updatedMap.set(ki.key_version, ki.key_hex);
        }
      }

      // Find the latest version to set as current
      let latestKeyInfo = s.keyInfo;
      let latestHex     = s.keyHex;

      if (keyHistory.length > 0) {
        const latest = keyHistory.reduce((a, b) =>
          a.key_version > b.key_version ? a : b
        );
        latestKeyInfo = latest;
        latestHex     = latest.key_hex ?? s.keyHex;
      }

      return {
        ...s,
        keyInfo:    latestKeyInfo,
        keyHex:     latestHex,
        keyHexMap:  updatedMap,
      };
    });
  }, []);

  // ── Apply a refreshed key (from key_refreshed socket event) ───────────────

  const applyRefreshedKey = useCallback(
    (keyInfo: KeyInfo, keyHistory?: KeyInfo[]) => {
      setState((s) => {
        const updatedMap = new Map(s.keyHexMap);

        // Add all history keys
        if (keyHistory) {
          for (const ki of keyHistory) {
            if (ki.key_hex && ki.key_hex.length === 64) {
              updatedMap.set(ki.key_version, ki.key_hex);
            }
          }
        }

        // Add the new key
        if (keyInfo.key_hex && keyInfo.key_hex.length === 64) {
          updatedMap.set(keyInfo.key_version, keyInfo.key_hex);
        }

        return {
          ...s,
          keyInfo,
          keyHex:    keyInfo.key_hex ?? s.keyHex,
          keyHexMap: updatedMap,
        };
      });
    },
    []
  );

  // ── Apply key from room_joined event ─────────────────────────────────────

  const applyKeyFromJoin = useCallback(
    (keyInfo: KeyInfo | null, keyHex?: string) => {
      if (!keyInfo) return;
      setState((s) => {
        const updatedMap = new Map(s.keyHexMap);
        const hex = keyHex ?? keyInfo.key_hex ?? s.keyHex;
        if (hex && hex.length === 64) {
          updatedMap.set(keyInfo.key_version, hex);
        }
        return {
          ...s,
          keyInfo,
          keyHex:    hex,
          keyHexMap: updatedMap,
        };
      });
    },
    []
  );

  return {
    ...state,
    generate,
    importKeyHistory,
    applyRefreshedKey,
    applyKeyFromJoin,
    hasKey: !!state.keyHex && state.keyHex.length === 64,
  };
}