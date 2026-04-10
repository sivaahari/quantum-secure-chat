// frontend/src/lib/bb84.ts
/**
 * Full BB84 quantum key distribution — TypeScript implementation.
 *
 * Runs entirely in the browser — no server involvement.
 * Cryptographically equivalent to the Python/Qiskit backend implementation.
 *
 * Protocol roles:
 *   Alice = initiator (creates offer, sends quantum states)
 *   Bob   = responder (receives states, measures, sends bases back)
 *
 * Key pipeline:
 *   1. Alice: random bits + random bases → encode qubits
 *   2. Simulate quantum channel with depolarizing noise
 *   3. Bob: random bases → measure qubits
 *   4. Exchange bases publicly (via DataChannel)
 *   5. Sift: keep only matching-basis positions
 *   6. QBER check: sacrifice 20% of sifted bits
 *   7. HKDF-SHA256 → 32-byte AES-256 key
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Bit   = 0 | 1;
export type Basis = 0 | 1;   // 0 = rectilinear (+), 1 = diagonal (×)

export interface QubitState {
  /** Alice's intended bit value */
  bit:   Bit;
  /** Alice's encoding basis */
  basis: Basis;
  /** Bloch vector after noise (for visualization) */
  bloch: { x: number; y: number; z: number };
}

export interface BB84AliceOutput {
  bits:       Bit[];
  bases:      Basis[];
  qubits:     QubitState[];
  numQubits:  number;
}

export interface BB84BobOutput {
  bases:      Basis[];
  measuredBits: Bit[];
}

export interface SiftResult {
  matchingIndices: number[];
  aliceSifted:     Bit[];
  bobSifted:       Bit[];
}

export interface QBERResult {
  qber:            number;
  safe:            boolean;   // true if qber < 0.11
  aliceRemaining:  Bit[];
  bobRemaining:    Bit[];
}

export interface BB84KeyResult {
  keyHex:        string;      // 64 hex chars = 32 bytes = AES-256
  keyBytes:      Uint8Array;
  qber:          number;
  qberSafe:      boolean;
  rawQubits:     number;
  siftedBits:    number;
  finalKeyBits:  number;
  efficiency:    number;
  blochVectors:  QubitState["bloch"][];
  aliceSample:   Bit[];
  bobSample:     Bit[];
  aliceBases:    Basis[];
  bobBases:      Basis[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const QBER_ABORT_THRESHOLD = 0.11;
export const SAMPLE_FRACTION      = 0.20;
export const DEFAULT_QUBITS       = 256;
export const DEFAULT_DEPOLAR      = 0.02;

// ─── 1. Alice prepares ────────────────────────────────────────────────────────

/** Generate cryptographically random bits using Web Crypto */
function randomBits(n: number): Bit[] {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => (b & 1) as Bit);
}

/** Generate random bases */
function randomBases(n: number): Basis[] {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => (b & 1) as Basis);
}

/**
 * Compute the Bloch vector for a given bit+basis combination.
 * Rectilinear (basis=0): |0⟩ = north pole, |1⟩ = south pole
 * Diagonal    (basis=1): |+⟩ = +X equator,  |−⟩ = -X equator
 */
function blochVector(bit: Bit, basis: Basis): { x: number; y: number; z: number } {
  if (basis === 0) return { x: 0,  y: 0, z: bit === 0 ? 1 : -1 };
  return              { x: bit === 0 ? 1 : -1, y: 0, z: 0 };
}

export function alicePrepare(
  numQubits:   number = DEFAULT_QUBITS,
): BB84AliceOutput {
  const bits  = randomBits(numQubits);
  const bases = randomBases(numQubits);
  const qubits: QubitState[] = bits.map((bit, i) => ({
    bit,
    basis: bases[i],
    bloch: blochVector(bit, bases[i]),
  }));
  return { bits, bases, qubits, numQubits };
}

// ─── 2. Quantum channel noise ─────────────────────────────────────────────────

/**
 * Simulate a depolarizing quantum channel.
 *
 * With probability p, a random Pauli error (X, Y, or Z) is applied.
 * For the purposes of key distribution:
 *   X error (bit flip)  → flips the bit
 *   Z error (phase flip)→ flips a diagonal-basis bit
 *   Y error             → both
 *
 * This produces the same statistical QBER as the Python Qiskit model.
 */
export function applyChannelNoise(
  qubits:      QubitState[],
  depolarProb: number = DEFAULT_DEPOLAR,
): QubitState[] {
  if (depolarProb <= 0) return qubits;

  const buf = new Uint8Array(qubits.length * 3);
  crypto.getRandomValues(buf);

  return qubits.map((q, i) => {
    const errorProb = buf[i * 3] / 255;
    if (errorProb >= depolarProb) return q;   // no error

    // Determine error type: 0=X, 1=Z, 2=Y
    const errorType = buf[i * 3 + 1] % 3;

    let newBit   = q.bit;
    const newBasis = q.basis;

    // X error (bit flip) — affects rectilinear and diagonal bits
    if (errorType === 0 || errorType === 2) {
      newBit = (1 - newBit) as Bit;
    }
    // Z error (phase flip) — only affects diagonal basis measurements
    if ((errorType === 1 || errorType === 2) && q.basis === 1) {
      newBit = (1 - newBit) as Bit;
    }

    return {
      bit:   newBit,
      basis: newBasis,
      bloch: blochVector(newBit, newBasis),
    };
  });
}

// ─── 3. Bob measures ─────────────────────────────────────────────────────────

export function bobChooseBases(numQubits: number): Basis[] {
  return randomBases(numQubits);
}

/**
 * Bob measures each qubit in his chosen basis.
 *
 * If Bob's basis matches Alice's: he gets the correct bit (with noise effects).
 * If Bob's basis doesn't match:  he gets a random result.
 *
 * This is the quantum measurement postulate applied to BB84 states.
 */
export function bobMeasure(
  noisyQubits: QubitState[],
  bobBases:    Basis[],
): Bit[] {
  const randomBuf = new Uint8Array(noisyQubits.length);
  crypto.getRandomValues(randomBuf);

  return noisyQubits.map((q, i) => {
    if (bobBases[i] === q.basis) {
      // Same basis → correct measurement (the noisy bit value)
      return q.bit;
    }
    // Different basis → completely random result (quantum indeterminacy)
    return (randomBuf[i] & 1) as Bit;
  });
}

// ─── 4. Basis sifting ─────────────────────────────────────────────────────────

export function siftKeys(
  aliceBits:  Bit[],
  aliceBases: Basis[],
  bobBits:    Bit[],
  bobBases:   Basis[],
): SiftResult {
  const matchingIndices: number[] = [];
  const aliceSifted:    Bit[]    = [];
  const bobSifted:      Bit[]    = [];

  for (let i = 0; i < aliceBases.length; i++) {
    if (aliceBases[i] === bobBases[i]) {
      matchingIndices.push(i);
      aliceSifted.push(aliceBits[i]);
      bobSifted.push(bobBits[i]);
    }
  }
  return { matchingIndices, aliceSifted, bobSifted };
}

// ─── 5. QBER estimation ───────────────────────────────────────────────────────

/**
 * Sacrifice SAMPLE_FRACTION of sifted bits to estimate error rate.
 * Returns QBER and the remaining bits for key derivation.
 */
export function estimateQBER(
  aliceSifted: Bit[],
  bobSifted:   Bit[],
  fraction:    number = SAMPLE_FRACTION,
): QBERResult {
  const n = aliceSifted.length;
  if (n === 0) {
    return { qber: 0, safe: true, aliceRemaining: [], bobRemaining: [] };
  }

  const sampleSize = Math.max(1, Math.floor(n * fraction));

  // Pick random sample indices
  const allIndices   = Array.from({ length: n }, (_, i) => i);
  const sampleSet    = new Set<number>();

  // Fisher-Yates partial shuffle to pick sampleSize unique indices
  const shuffleBuf = new Uint32Array(n);
  crypto.getRandomValues(shuffleBuf);
  const indexed = allIndices.map((v, i) => ({ v, r: shuffleBuf[i] }));
  indexed.sort((a, b) => a.r - b.r);
  indexed.slice(0, sampleSize).forEach(({ v }) => sampleSet.add(v));

  let errors = 0;
  sampleSet.forEach((i) => {
    if (aliceSifted[i] !== bobSifted[i]) errors++;
  });

  const qber = errors / sampleSize;
  const aliceRemaining = aliceSifted.filter((_, i) => !sampleSet.has(i));
  const bobRemaining   = bobSifted.filter((_, i) => !sampleSet.has(i));

  return {
    qber,
    safe: qber < QBER_ABORT_THRESHOLD,
    aliceRemaining,
    bobRemaining,
  };
}

// ─── 6. Privacy amplification (HKDF-SHA256) ──────────────────────────────────

/**
 * Derive a 32-byte AES-256 key from raw key bits using HKDF-SHA256.
 * Compatible with the Python backend's privacy_amplification() function.
 */
export async function privacyAmplification(
  keyBits:     Bit[],
  targetBytes: number = 32,
): Promise<Uint8Array> {
  if (keyBits.length < 8) {
    // Fallback: OS random (shouldn't happen with enough qubits)
    const fallback = new Uint8Array(targetBytes);
    crypto.getRandomValues(fallback);
    return fallback;
  }

  // Convert bit array → bytes
  const padded = [...keyBits];
  const rem    = padded.length % 8;
  if (rem) for (let i = 0; i < 8 - rem; i++) padded.push(0);

  const keyBytes = new Uint8Array(padded.length / 8);
  for (let i = 0; i < keyBytes.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | padded[i * 8 + j];
    }
    keyBytes[i] = byte;
  }

  // HKDF extract + expand
  const rawKey = await crypto.subtle.importKey(
    "raw", keyBytes, "HKDF", false, ["deriveBits"]
  );

  const salt = new TextEncoder().encode("quantum-llm-chat-v1");
  const info = new TextEncoder().encode("bb84-aes256-key");

  const derived = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    rawKey,
    targetBytes * 8,
  );

  return new Uint8Array(derived);
}

// ─── 7. Utility: bytes → hex ──────────────────────────────────────────────────

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}