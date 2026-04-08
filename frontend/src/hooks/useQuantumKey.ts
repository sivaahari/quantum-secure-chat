// frontend/src/hooks/useQuantumKey.ts
/**
 * Manages quantum key state: generation, storage, and refresh tracking.
 * The key_hex is stored in React state (memory only — never persisted).
 */

import { useState, useCallback } from "react";
import type { KeyInfo, BB84Stats } from "@/types";
import { generateQuantumKey } from "@/lib/api";
import { toast } from "sonner";

export interface QuantumKeyState {
  keyInfo:    KeyInfo | null;
  bb84Stats:  BB84Stats | null;
  keyHex:     string;            // full 64-char hex (32 bytes) — kept in memory
  generating: boolean;
  error:      string | null;
}

export function useQuantumKey(roomId: string) {
  const [state, setState] = useState<QuantumKeyState>({
    keyInfo:    null,
    bb84Stats:  null,
    keyHex:     "",
    generating: false,
    error:      null,
  });

  // ── Generate new key via BB84 ──────────────────────────────────────────────

  const generate = useCallback(
    async (opts?: {
      numQubits?:    number;
      noiseEnabled?: boolean;
      depolarProb?:  number;
      eavesdropProb?: number;
    }) => {
      setState((s) => ({ ...s, generating: true, error: null }));

      try {
        const result = await generateQuantumKey({
          room_id:       roomId,
          num_qubits:    opts?.numQubits    ?? 256,
          noise_enabled: opts?.noiseEnabled ?? true,
          depolar_prob:  opts?.depolarProb  ?? 0.02,
          eavesdrop_prob: opts?.eavesdropProb ?? 0.0,
        });

        setState({
          keyInfo:    result.key_info,
          bb84Stats:  result.bb84,
          keyHex:     result.key_info.key_hex,   // store full key in memory
          generating: false,
          error:      null,
        });

        toast.success(
          `🔑 Quantum key v${result.key_version} generated — ` +
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

  // ── Update key from SocketIO key_refreshed event ───────────────────────────

 const applyRefreshedKey = useCallback((keyInfo: KeyInfo) => {
    setState((s) => ({
      ...s,
      keyInfo,
      // key_hex only arrives on generate, not on refresh event from server
      // So only update keyHex if the event actually contains it
      keyHex: (keyInfo as KeyInfo & { key_hex?: string }).key_hex
              ?? s.keyHex,
    }));
  }, []);   

  // ── Load key from room_joined event ───────────────────────────────────────

 const applyKeyFromJoin = useCallback(
    (keyInfo: KeyInfo | null, keyHex?: string) => {
      if (!keyInfo) return;
      setState((s) => ({
        ...s,
        keyInfo,
        keyHex: keyHex ?? (keyInfo as KeyInfo & { key_hex?: string }).key_hex ?? s.keyHex,
      }));
    },
    []
  );

  return {
    ...state,
    generate,
    applyRefreshedKey,
    applyKeyFromJoin,
    hasKey: !!state.keyHex && state.keyHex.length === 64,
  };
}