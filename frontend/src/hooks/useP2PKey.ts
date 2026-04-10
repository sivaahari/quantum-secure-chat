// frontend/src/hooks/useP2PKey.ts
/**
 * Orchestrates BB84 key exchange over the WebRTC DataChannel.
 *
 * Key fix from v1:
 *  - `send` is stored in a ref so it's always the latest function
 *    without requiring the hook to recreate all callbacks
 *  - `role` is also a ref for the same reason
 *  - All async message handlers are stable (no stale closure bugs)
 */

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { P2PRole, P2PMessage, P2PMessageType } from "@/lib/webrtc";
import {
  alicePrepare,
  applyChannelNoise,
  bobChooseBases,
  bobMeasure,
  siftKeys,
  estimateQBER,
  privacyAmplification,
  bytesToHex,
  type BB84KeyResult,
  type Bit,
  type Basis,
  DEFAULT_QUBITS,
  DEFAULT_DEPOLAR,
} from "@/lib/bb84";

// ─── Types ────────────────────────────────────────────────────────────────────

export type P2PKeyStatus =
  | "idle"
  | "preparing"
  | "transmitting"
  | "measuring"
  | "sifting"
  | "estimating_qber"
  | "deriving"
  | "complete"
  | "aborted"
  | "error";

export interface P2PKeyState {
  status:    P2PKeyStatus;
  keyResult: BB84KeyResult | null;
  keyHex:    string;
  error:     string | null;
  progress:  number;
  log:       string[];
}

interface UseP2PKeyProps {
  roleRef:       React.MutableRefObject<P2PRole | null>;
  sendRef:       React.MutableRefObject<(type: P2PMessageType, payload: unknown) => boolean>;
  numQubits?:    number;
  depolar?:      number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useP2PKey({
  roleRef,
  sendRef,
  numQubits = DEFAULT_QUBITS,
  depolar   = DEFAULT_DEPOLAR,
}: UseP2PKeyProps) {
  const [state, setState] = useState<P2PKeyState>({
    status:    "idle",
    keyResult: null,
    keyHex:    "",
    error:     null,
    progress:  0,
    log:       [],
  });

  // Intermediate data for the async protocol steps
  const aliceData = useRef<{
    bits?:      Bit[];
    bases?:     Basis[];
    numQubits?: number;
  }>({});

  const bobData = useRef<{
    bobBases?:    Basis[];
    bobMeasured?: Bit[];
    bobSifted?:   Bit[];
  }>({});

  // ── Helpers ───────────────────────────────────────────────────────────────

  const addLog = useCallback((msg: string) => {
    setState((s) => ({
      ...s,
      log: [...s.log.slice(-19), `[${new Date().toLocaleTimeString()}] ${msg}`],
    }));
  }, []);

  const setProgress = useCallback((p: number) => {
    setState((s) => ({ ...s, progress: p }));
  }, []);

  const doAbort = useCallback((reason: string) => {
    setState((s) => ({ ...s, status: "aborted", error: reason, progress: 0 }));
    sendRef.current("bb84_abort", { reason });
    toast.error(`BB84 aborted: ${reason}`);
  }, [sendRef]);

  // ── ALICE: start the protocol ─────────────────────────────────────────────

  const aliceInitiate = useCallback(async () => {
    if (roleRef.current !== "alice") {
      console.warn("[useP2PKey] aliceInitiate called but role is", roleRef.current);
      return;
    }

    // Reset state
    aliceData.current = {};
    bobData.current   = {};
    setState({ status: "preparing", keyResult: null, keyHex: "", error: null, progress: 5, log: [] });
    addLog(`⚛ Alice preparing ${numQubits} qubits…`);

    // Step 1: prepare qubits
    const { bits, bases, qubits } = alicePrepare(numQubits);
    setProgress(15);
    addLog(`✓ ${numQubits} qubits prepared`);

    // Step 2: noise
    setState((s) => ({ ...s, status: "transmitting" }));
    const noisyQubits = applyChannelNoise(qubits, depolar);
    addLog(`⚡ Depolarizing noise applied (p=${depolar})`);
    setProgress(25);

    // Step 3: send qubit states to Bob
    const qubitPayload = noisyQubits.map((q) => ({ bit: q.bit, basis: q.basis }));
    const sent = sendRef.current("bb84_qubits", {
      qubits:    qubitPayload,
      numQubits,
      blochVecs: noisyQubits.slice(0, 8).map((q) => q.bloch),
    });

    if (!sent) {
      doAbort("DataChannel not open. Make sure the P2P connection is established first.");
      return;
    }

    addLog(`📡 Qubit states transmitted to Bob`);
    setProgress(35);
    setState((s) => ({ ...s, status: "sifting" }));

    // Stash for later use in message handlers
    aliceData.current = { bits, bases, numQubits };
  }, [roleRef, numQubits, depolar, sendRef, addLog, setProgress, doAbort]);

  // ── Message handler — called by useWebRTC when DataChannel receives data ──

  const handleP2PMessage = useCallback(async (msg: P2PMessage) => {
    const { type, payload } = msg;
    const role = roleRef.current;

    // ── BOB: receives qubit states from Alice ─────────────────────────────
    if (type === "bb84_qubits" && role === "bob") {
      const { qubits: receivedQubits, numQubits: n } = payload as {
        qubits: Array<{ bit: Bit; basis: Basis }>;
        numQubits: number;
      };

      setState((s) => ({ ...s, status: "measuring", progress: 30 }));
      addLog(`📥 Bob received ${n} qubit states`);

      const myBases  = bobChooseBases(n);
      const measured = bobMeasure(
        receivedQubits.map((q) => ({ bit: q.bit, basis: q.basis, bloch: { x: 0, y: 0, z: 0 } })),
        myBases,
      );

      bobData.current = { bobBases: myBases, bobMeasured: measured };

      addLog(`🎲 Bob measured all qubits`);
      setProgress(45);

      sendRef.current("bb84_bob_bases", { bases: myBases });
      addLog(`📤 Bob sent basis choices to Alice`);
      setState((s) => ({ ...s, status: "sifting" }));
    }

    // ── ALICE: receives Bob's bases ────────────────────────────────────────
    else if (type === "bb84_bob_bases" && role === "alice") {
      const { bases: bobBases } = payload as { bases: Basis[] };
      const { bits, bases: aliceBases } = aliceData.current;

      if (!bits || !aliceBases) { doAbort("Alice state missing"); return; }

      addLog(`📥 Alice received Bob's ${bobBases.length} basis choices`);
      setProgress(50);

      // Sift: keep positions where bases match
      const aliceSifted: Bit[]   = [];
      const matchingIndices: number[] = [];
      for (let i = 0; i < aliceBases.length; i++) {
        if (aliceBases[i] === bobBases[i]) {
          aliceSifted.push(bits[i]);
          matchingIndices.push(i);
        }
      }

      addLog(`✂ Sifted: ${aliceSifted.length}/${bits.length} bits kept (~${Math.round(aliceSifted.length / bits.length * 100)}%)`);
      setProgress(60);

      // Send Alice's bases so Bob can sift
      sendRef.current("bb84_alice_bases", { bases: aliceBases });
      addLog(`📤 Alice sent her bases to Bob`);

      // Prepare QBER sample (sacrifice first 20% of sifted bits)
      const sampleSize  = Math.max(1, Math.floor(aliceSifted.length * 0.20));
      const aliceSample = aliceSifted.slice(0, sampleSize);
      const remaining   = aliceSifted.slice(sampleSize);

      sendRef.current("bb84_qber_sample", {
        sample:          aliceSample,
        matchingIndices,
      });
      addLog(`📊 Sent QBER sample (${sampleSize} bits) to Bob`);
      setState((s) => ({ ...s, status: "estimating_qber" }));

      // Stash remaining bits for key derivation after QBER confirmed
      aliceData.current.bits = remaining;
    }

    // ── BOB: receives Alice's bases — now can sift ──────────────────────────
    else if (type === "bb84_alice_bases" && role === "bob") {
      const { bases: aliceBases } = payload as { bases: Basis[] };
      const { bobBases, bobMeasured } = bobData.current;

      if (!bobBases || !bobMeasured) return;

      const bobSifted: Bit[] = [];
      for (let i = 0; i < aliceBases.length; i++) {
        if (aliceBases[i] === bobBases[i]) {
          bobSifted.push(bobMeasured[i]);
        }
      }

      bobData.current.bobSifted = bobSifted;
      addLog(`✂ Bob sifted: ${bobSifted.length} bits kept`);
      setProgress(65);
    }

    // ── BOB: receives QBER sample — checks error rate, derives key ─────────
    else if (type === "bb84_qber_sample" && role === "bob") {
      const { sample: aliceSample, matchingIndices } = payload as {
        sample:          Bit[];
        matchingIndices: number[];
      };
      const { bobSifted } = bobData.current;

      if (!bobSifted) {
        doAbort("Bob sifted bits missing — bases may not have arrived yet");
        return;
      }

      setState((s) => ({ ...s, status: "estimating_qber" }));
      const sampleSize = aliceSample.length;

      // Compare Bob's sifted bits against Alice's sample
      let errors = 0;
      for (let i = 0; i < Math.min(sampleSize, bobSifted.length); i++) {
        if (aliceSample[i] !== bobSifted[i]) errors++;
      }
      const qber = sampleSize > 0 ? errors / sampleSize : 0;
      const safe = qber < 0.11;

      addLog(`📈 QBER = ${(qber * 100).toFixed(2)}% ${safe ? "✅ SAFE" : "❌ UNSAFE"}`);
      sendRef.current("bb84_qber_result", { qber, safe });

      if (!safe) {
        setState((s) => ({
          ...s,
          status: "aborted",
          error:  `QBER ${(qber * 100).toFixed(2)}% — possible eavesdropper`,
        }));
        toast.error(`🚨 Key exchange aborted — QBER too high`);
        return;
      }

      // Derive key from remaining sifted bits (after the sacrificed sample)
      setState((s) => ({ ...s, status: "deriving", progress: 80 }));
      addLog(`🔑 Deriving AES-256 key via HKDF-SHA256…`);

      const remaining = bobSifted.slice(sampleSize);
      const keyBytes  = await privacyAmplification(remaining, 32);
      const keyHex    = bytesToHex(keyBytes);

      const result: BB84KeyResult = {
        keyHex, keyBytes, qber, qberSafe: true,
        rawQubits:    matchingIndices.length + sampleSize,
        siftedBits:   bobSifted.length,
        finalKeyBits: 256,
        efficiency:   bobSifted.length / Math.max(1, matchingIndices.length + sampleSize),
        blochVectors: [], aliceSample, bobSample: bobSifted.slice(0, sampleSize),
        aliceBases: [], bobBases: bobData.current.bobBases?.slice(0, 32) ?? [],
      };

      setState((s) => ({ ...s, status: "complete", keyResult: result, keyHex, progress: 100 }));
      addLog(`✅ Bob: key ready — ${keyHex.slice(0, 16)}…`);
      toast.success(`🔑 P2P key established (Bob) — QBER: ${(qber * 100).toFixed(2)}%`);
    }

    // ── ALICE: Bob confirms QBER — derive key ──────────────────────────────
    else if (type === "bb84_qber_result" && role === "alice") {
      const { qber, safe } = payload as { qber: number; safe: boolean };

      if (!safe) { doAbort(`QBER ${(qber * 100).toFixed(2)}% — eavesdropper detected`); return; }

      addLog(`✅ QBER confirmed = ${(qber * 100).toFixed(2)}%`);
      setState((s) => ({ ...s, status: "deriving", progress: 80 }));
      addLog(`🔑 Deriving AES-256 key via HKDF-SHA256…`);

      const remaining = aliceData.current.bits;
      const n         = aliceData.current.numQubits ?? numQubits;
      if (!remaining || remaining.length === 0) { doAbort("Alice remaining bits missing"); return; }

      const keyBytes = await privacyAmplification(remaining, 32);
      const keyHex   = bytesToHex(keyBytes);

      const result: BB84KeyResult = {
        keyHex, keyBytes, qber, qberSafe: true,
        rawQubits: n, siftedBits: remaining.length,
        finalKeyBits: 256,
        efficiency: remaining.length / n,
        blochVectors: [], aliceSample: [], bobSample: [],
        aliceBases: aliceData.current.bases?.slice(0, 32) ?? [], bobBases: [],
      };

      setState((s) => ({ ...s, status: "complete", keyResult: result, keyHex, progress: 100 }));
      addLog(`✅ Alice: key ready — ${keyHex.slice(0, 16)}…`);
      toast.success(`🔑 P2P key established (Alice) — QBER: ${(qber * 100).toFixed(2)}%`);
    }

    // ── Either side: peer aborted ──────────────────────────────────────────
    else if (type === "bb84_abort") {
      const { reason } = payload as { reason: string };
      setState((s) => ({ ...s, status: "aborted", error: `Peer: ${reason}`, progress: 0 }));
      toast.error(`Peer aborted: ${reason}`);
    }
  }, [roleRef, sendRef, numQubits, addLog, setProgress, doAbort]);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    aliceData.current = {};
    bobData.current   = {};
    setState({ status: "idle", keyResult: null, keyHex: "", error: null, progress: 0, log: [] });
  }, []);

  return {
    ...state,
    aliceInitiate,
    handleP2PMessage,
    reset,
    hasKey: state.status === "complete" && state.keyHex.length === 64,
  };
}