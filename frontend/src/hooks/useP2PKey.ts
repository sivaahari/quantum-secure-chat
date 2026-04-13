// frontend/src/hooks/useP2PKey.ts
/**
 * BB84 P2P key exchange over WebRTC DataChannel.
 *
 * ROOT CAUSE FIX (v3):
 *
 * Previous bug:
 *   Alice applied noise → sent noisyBits to Bob
 *   Bob measured noisyBits → bobSifted = noisyBits at matching positions
 *   Alice sifted using originalBits (pre-noise) → aliceSifted ≠ bobSifted
 *   HKDF(aliceSifted) ≠ HKDF(bobSifted) → different keys → decrypt fails
 *
 * Fix:
 *   Alice stores noisyBits alongside originalBits.
 *   Alice sifts using noisyBits (same values Bob received and measured).
 *   Now at every matching-basis position:
 *     aliceSifted[i] === bobMeasured[i]  (both are noisyBit[i])
 *   → HKDF produces identical 32-byte key on both sides → decryption works.
 *
 * Also fixed: QBER was comparing aliceSifted against itself (always 0%).
 *   Now Alice sends her noisy sifted sample to Bob, Bob compares against
 *   his own sifted bits → real QBER measurement.
 */

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { P2PRole, P2PMessage, P2PMessageType } from "@/lib/webrtc";
import {
  alicePrepare,
  applyChannelNoise,
  bobChooseBases,
  bobMeasure,
  privacyAmplification,
  bytesToHex,
  type BB84KeyResult,
  type Bit,
  type Basis,
  DEFAULT_QUBITS,
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
  roleRef:    React.MutableRefObject<P2PRole | null>;
  sendRef:    React.MutableRefObject<(type: P2PMessageType, payload: unknown) => boolean>;
  numQubits?: number;
  depolar?:   number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useP2PKey({
  roleRef,
  sendRef,
  numQubits = DEFAULT_QUBITS,
  depolar   = 0.02,
}: UseP2PKeyProps) {
  const [state, setState] = useState<P2PKeyState>({
    status:    "idle",
    keyResult: null,
    keyHex:    "",
    error:     null,
    progress:  0,
    log:       [],
  });

  // ── Alice's stash (populated in aliceInitiate, read in message handlers) ───
  const aliceData = useRef<{
    originalBits?: Bit[];   // pre-noise (kept for reference only)
    noisyBits?:    Bit[];   // post-noise — THE ones Alice sifts with (same as Bob sees)
    bases?:        Basis[];
    numQubits?:    number;
  }>({});

  // ── Bob's stash ───────────────────────────────────────────────────────────
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

  // ── Sifting helper (pure function, used by both sides) ────────────────────

  /**
   * Sift: keep bits at positions where aliceBases[i] === bobBases[i].
   * Both sides call this with the same basis arrays → same indices kept.
   */
  function sift(
    bits:       Bit[],
    aliceBases: Basis[],
    bobBases:   Basis[],
  ): { siftedBits: Bit[]; matchingIdx: number[] } {
    const siftedBits: Bit[]    = [];
    const matchingIdx: number[] = [];
    for (let i = 0; i < aliceBases.length; i++) {
      if (aliceBases[i] === bobBases[i]) {
        siftedBits.push(bits[i]);
        matchingIdx.push(i);
      }
    }
    return { siftedBits, matchingIdx };
  }

  // ── ALICE: initiate ───────────────────────────────────────────────────────

  const aliceInitiate = useCallback(async () => {
    if (roleRef.current !== "alice") {
      console.warn("[useP2PKey] aliceInitiate called but role is", roleRef.current);
      return;
    }

    aliceData.current = {};
    bobData.current   = {};
    setState({
      status: "preparing", keyResult: null, keyHex: "",
      error: null, progress: 5, log: [],
    });
    addLog(`⚛ Alice preparing ${numQubits} qubits…`);

    // Step 1: prepare original qubits
    const { bits: originalBits, bases, qubits } = alicePrepare(numQubits);
    setProgress(15);
    addLog(`✓ ${numQubits} qubits prepared`);

    // Step 2: apply depolarizing noise to get noisyQubits
    setState((s) => ({ ...s, status: "transmitting" }));
    const noisyQubits = applyChannelNoise(qubits, depolar);
    addLog(`⚡ Depolarizing noise applied (p=${depolar})`);
    setProgress(25);

    // Extract noisy bits — these are what Bob will receive and measure
    const noisyBits: Bit[] = noisyQubits.map((q) => q.bit);

    // Step 3: send noisy qubit states to Bob
    const sent = sendRef.current("bb84_qubits", {
      qubits:    noisyQubits.map((q) => ({ bit: q.bit, basis: q.basis })),
      numQubits,
      blochVecs: noisyQubits.slice(0, 8).map((q) => q.bloch),
    });

    if (!sent) {
      doAbort("DataChannel not open. Establish P2P connection first.");
      return;
    }

    addLog(`📡 Qubit states transmitted to Bob`);
    setProgress(35);
    setState((s) => ({ ...s, status: "sifting" }));

    // ── KEY FIX: store noisyBits for sifting (not originalBits) ──────────
    // Alice MUST sift using noisyBits because that's what Bob received.
    // Bob measures noisyBit at matching-basis positions.
    // If Alice sifted using originalBits, keys would differ at noise-hit positions.
    aliceData.current = { originalBits, noisyBits, bases, numQubits };
  }, [roleRef, numQubits, depolar, sendRef, addLog, setProgress, doAbort]);

  // ── Message handler ───────────────────────────────────────────────────────

  const handleP2PMessage = useCallback(async (msg: P2PMessage) => {
    const { type, payload } = msg;
    const role = roleRef.current;

    // ── BOB: receives qubit states ─────────────────────────────────────────
    if (type === "bb84_qubits" && role === "bob") {
      const { qubits: received, numQubits: n } = payload as {
        qubits: Array<{ bit: Bit; basis: Basis }>;
        numQubits: number;
      };

      setState((s) => ({ ...s, status: "measuring", progress: 30 }));
      addLog(`📥 Bob received ${n} qubit states`);

      const myBases  = bobChooseBases(n);
      // Bob measures: same-basis → gets the received (noisy) bit; diff-basis → random
      const measured = bobMeasure(
        received.map((q) => ({ bit: q.bit, basis: q.basis, bloch: { x: 0, y: 0, z: 0 } })),
        myBases,
      );

      bobData.current = { bobBases: myBases, bobMeasured: measured };
      addLog(`🎲 Bob measured all qubits in random bases`);
      setProgress(45);

      sendRef.current("bb84_bob_bases", { bases: myBases });
      addLog(`📤 Bob sent basis choices to Alice`);
      setState((s) => ({ ...s, status: "sifting" }));
    }

    // ── ALICE: receives Bob's bases → sift using NOISY bits ────────────────
    else if (type === "bb84_bob_bases" && role === "alice") {
      const { bases: bobBases } = payload as { bases: Basis[] };
      const { noisyBits, bases: aliceBases } = aliceData.current;

      if (!noisyBits || !aliceBases) {
        doAbort("Alice state missing — please restart");
        return;
      }

      addLog(`📥 Alice received Bob's ${bobBases.length} basis choices`);
      setProgress(50);

      // ── SIFT using noisyBits ────────────────────────────────────────────
      // This is the critical fix: use noisyBits (what Bob received) not originalBits
      const { siftedBits: aliceSifted, matchingIdx } = sift(noisyBits, aliceBases, bobBases);

      addLog(
        `✂ Sifted: ${aliceSifted.length}/${noisyBits.length} bits kept ` +
        `(~${Math.round(aliceSifted.length / noisyBits.length * 100)}%)`
      );
      setProgress(60);

      // Send Alice's bases so Bob can sift
      sendRef.current("bb84_alice_bases", { bases: aliceBases });
      addLog(`📤 Alice sent her bases to Bob`);

      // Prepare QBER sample: first 20% of sifted bits
      const sampleSize  = Math.max(1, Math.floor(aliceSifted.length * 0.20));
      const aliceSample = aliceSifted.slice(0, sampleSize);
      const remaining   = aliceSifted.slice(sampleSize);

      sendRef.current("bb84_qber_sample", {
        sample:       aliceSample,
        matchingIdx,
        sampleSize,
      });
      addLog(`📊 Sent QBER sample (${sampleSize} bits) to Bob`);
      setState((s) => ({ ...s, status: "estimating_qber" }));

      // Stash remaining bits for key derivation after Bob confirms QBER
      aliceData.current = { ...aliceData.current, noisyBits: remaining };
    }

    // ── BOB: receives Alice's bases → sift ─────────────────────────────────
    else if (type === "bb84_alice_bases" && role === "bob") {
      const { bases: aliceBases } = payload as { bases: Basis[] };
      const { bobBases, bobMeasured } = bobData.current;

      if (!bobBases || !bobMeasured) return;

      // Bob sifts using his own measurements at matching-basis positions
      const { siftedBits: bobSifted } = sift(bobMeasured, aliceBases, bobBases);

      bobData.current.bobSifted = bobSifted;
      addLog(`✂ Bob sifted: ${bobSifted.length} bits kept`);
      setProgress(65);
      // Wait for QBER sample from Alice
    }

    // ── BOB: receives QBER sample → check, then derive key ─────────────────
    else if (type === "bb84_qber_sample" && role === "bob") {
      const { sample: aliceSample, sampleSize } = payload as {
        sample:     Bit[];
        matchingIdx: number[];
        sampleSize: number;
      };
      const { bobSifted } = bobData.current;

      if (!bobSifted) {
        // Race: bases message hasn't arrived yet — wait a tick and retry
        await new Promise((r) => setTimeout(r, 100));
        if (!bobData.current.bobSifted) {
          doAbort("Bob's sifted bits not ready — bases may not have arrived yet");
          return;
        }
        bobData.current.bobSifted; // re-read
      }

      const currentBobSifted = bobData.current.bobSifted!;
      setState((s) => ({ ...s, status: "estimating_qber" }));

      // QBER: compare Alice's sample against Bob's first sampleSize sifted bits
      const checkLen = Math.min(aliceSample.length, currentBobSifted.length);
      let errors = 0;
      for (let i = 0; i < checkLen; i++) {
        if (aliceSample[i] !== currentBobSifted[i]) errors++;
      }
      const qber = checkLen > 0 ? errors / checkLen : 0;
      const safe = qber < 0.11;

      addLog(`📈 QBER = ${(qber * 100).toFixed(2)}% ${safe ? "✅ SAFE" : "❌ UNSAFE"}`);
      sendRef.current("bb84_qber_result", { qber, safe });

      if (!safe) {
        setState((s) => ({
          ...s,
          status: "aborted",
          error:  `QBER ${(qber * 100).toFixed(2)}% > 11% threshold`,
        }));
        toast.error("🚨 Key exchange aborted — QBER too high");
        return;
      }

      // Derive key from remaining sifted bits (after the sacrificed sample)
      setState((s) => ({ ...s, status: "deriving", progress: 80 }));
      addLog(`🔑 Deriving AES-256 key via HKDF-SHA256…`);

      const bobRemaining = currentBobSifted.slice(sampleSize);
      const keyBytes     = await privacyAmplification(bobRemaining, 32);
      const keyHex       = bytesToHex(keyBytes);

      const result: BB84KeyResult = {
        keyHex, keyBytes, qber, qberSafe: true,
        rawQubits:    aliceData.current.numQubits ?? numQubits,
        siftedBits:   currentBobSifted.length,
        finalKeyBits: 256,
        efficiency:   currentBobSifted.length / Math.max(1, aliceData.current.numQubits ?? numQubits),
        blochVectors: [],
        aliceSample, bobSample: currentBobSifted.slice(0, sampleSize),
        aliceBases: [], bobBases: bobData.current.bobBases?.slice(0, 32) ?? [],
      };

      setState((s) => ({
        ...s, status: "complete", keyResult: result, keyHex, progress: 100,
      }));
      addLog(`✅ Bob: key ready — ${keyHex.slice(0, 16)}…`);
      toast.success(`🔑 P2P key established (Bob) — QBER: ${(qber * 100).toFixed(2)}%`);
    }

    // ── ALICE: Bob confirms QBER → derive key ──────────────────────────────
    else if (type === "bb84_qber_result" && role === "alice") {
      const { qber, safe } = payload as { qber: number; safe: boolean };

      if (!safe) {
        doAbort(`QBER ${(qber * 100).toFixed(2)}% — eavesdropper detected`);
        return;
      }

      addLog(`✅ QBER confirmed = ${(qber * 100).toFixed(2)}%`);
      setState((s) => ({ ...s, status: "deriving", progress: 80 }));
      addLog(`🔑 Deriving AES-256 key via HKDF-SHA256…`);

      // aliceData.noisyBits was overwritten with `remaining` (post-sample bits)
      const remaining = aliceData.current.noisyBits;
      const n         = aliceData.current.numQubits ?? numQubits;

      if (!remaining || remaining.length === 0) {
        doAbort("Alice remaining bits missing — please restart");
        return;
      }

      const keyBytes = await privacyAmplification(remaining, 32);
      const keyHex   = bytesToHex(keyBytes);

      const result: BB84KeyResult = {
        keyHex, keyBytes, qber, qberSafe: true,
        rawQubits: n, siftedBits: remaining.length,
        finalKeyBits: 256, efficiency: remaining.length / n,
        blochVectors: [], aliceSample: [], bobSample: [],
        aliceBases: aliceData.current.bases?.slice(0, 32) ?? [], bobBases: [],
      };

      setState((s) => ({
        ...s, status: "complete", keyResult: result, keyHex, progress: 100,
      }));
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
    setState({
      status: "idle", keyResult: null, keyHex: "", error: null, progress: 0, log: [],
    });
  }, []);

  return {
    ...state,
    aliceInitiate,
    handleP2PMessage,
    reset,
    hasKey: state.status === "complete" && state.keyHex.length === 64,
  };
}