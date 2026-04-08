# backend/quantum/bb84.py
"""
BB84 Quantum Key Distribution — full protocol simulation.

Pipeline:
  1. Alice  → random bits + random bases
  2. Encode → Qiskit QuantumCircuit per qubit
  3. Channel → AerSimulator with optional noise model
  4. Bob    → random bases + measurement outcomes
  5. Sift   → matching-basis bits only
  6. QBER   → error rate estimation on sacrificed sample
  7. Reconcile → parity-block error correction
  8. Amplify   → HKDF-SHA256 → 32-byte AES-256 key

Qiskit 2.x API notes:
  - No execute() — use transpile() + backend.run()
  - AerSimulator imported from qiskit_aer
  - Statevector from qiskit.quantum_info
"""

import time
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

from .noise_model import build_noise_model
from .key_utils import (
    sift_keys,
    estimate_qber,
    reconcile_errors,
    privacy_amplification,
    bits_to_bloch_vectors,
    bits_to_hex,
)


# ─────────────────────────────────────────────────────────────────────────────
# Result dataclass
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class BB84Result:
    """
    Complete output of one BB84 key-exchange session.
    All list fields use Python native ints (not numpy int64) for JSON safety.
    """
    # Raw protocol data
    num_qubits:         int = 0
    alice_bits:         List[int] = field(default_factory=list)
    alice_bases:        List[int] = field(default_factory=list)
    bob_bases:          List[int] = field(default_factory=list)
    bob_bits:           List[int] = field(default_factory=list)

    # Sifted key (before QBER sampling)
    matching_indices:   List[int] = field(default_factory=list)
    alice_sifted:       List[int] = field(default_factory=list)
    bob_sifted:         List[int] = field(default_factory=list)

    # Error estimation
    qber:               float = 0.0
    qber_safe:          bool  = True   # True if QBER < 0.11

    # Reconciled + amplified key
    alice_reconciled:   List[int] = field(default_factory=list)
    bob_reconciled:     List[int] = field(default_factory=list)
    final_key_bytes:    bytes = b""    # 32-byte AES-256 key
    final_key_hex:      str   = ""

    # Visualisation data
    bloch_vectors:      List[Dict[str, Any]] = field(default_factory=list)

    # Statistics
    raw_key_length:     int   = 0
    sifted_key_length:  int   = 0
    final_key_length:   int   = 0
    sifting_efficiency: float = 0.0   # sifted / raw
    simulation_time_ms: float = 0.0
    noise_enabled:      bool  = False
    key_hex_preview:    str   = ""    # first 8 chars of key hex for UI display

    def to_dict(self) -> Dict[str, Any]:
        """
        JSON-serialisable dictionary — omits raw bit arrays (too large for API),
        keeps statistics and visualisation data.
        """
        return {
            "num_qubits":         self.num_qubits,
            "raw_key_length":     self.raw_key_length,
            "sifted_key_length":  self.sifted_key_length,
            "final_key_length":   self.final_key_length,
            "sifting_efficiency": round(self.sifting_efficiency, 4),
            "qber":               round(self.qber, 4),
            "qber_safe":          self.qber_safe,
            "noise_enabled":      self.noise_enabled,
            "final_key_hex":      self.final_key_hex,
            "key_hex_preview":    self.key_hex_preview,
            "bloch_vectors":      self.bloch_vectors,
            "simulation_time_ms": round(self.simulation_time_ms, 2),
            # Include first 32 sifted bits as sample for UI display
            "alice_sifted_sample": self.alice_sifted[:32],
            "bob_sifted_sample":   self.bob_sifted[:32],
            "alice_bases_sample":  self.alice_bases[:32],
            "bob_bases_sample":    self.bob_bases[:32],
        }


# ─────────────────────────────────────────────────────────────────────────────
# Core BB84 engine
# ─────────────────────────────────────────────────────────────────────────────

class BB84Protocol:
    """
    Simulates a full BB84 quantum key distribution exchange.

    Usage
    -----
    protocol = BB84Protocol(num_qubits=256, noise_enabled=True)
    result   = protocol.run()
    aes_key  = result.final_key_bytes   # 32 bytes, ready for AES-256-GCM
    """

    # Security threshold: if QBER exceeds this, abort key exchange
    QBER_ABORT_THRESHOLD = 0.11

    def __init__(
        self,
        num_qubits:      int   = 256,
        noise_enabled:   bool  = True,
        depolar_prob:    float = 0.02,
        readout_err:     float = 0.01,
        eavesdrop_prob:  float = 0.0,
        seed:            Optional[int] = None,
    ):
        self.num_qubits     = num_qubits
        self.noise_enabled  = noise_enabled
        self.depolar_prob   = depolar_prob
        self.readout_err    = readout_err
        self.eavesdrop_prob = eavesdrop_prob
        self.rng            = np.random.default_rng(seed)

        # Build the Aer backend once (reused across calls)
        if noise_enabled:
            nm = build_noise_model(
                depolar_prob=depolar_prob,
                readout_error_prob=readout_err,
                eavesdrop_prob=eavesdrop_prob,
            )
            self._backend = AerSimulator(
                method="automatic",
                noise_model=nm
            )
        else:
            self._backend = AerSimulator(
                method="automatic"
            )

    # ── Step 1: Alice prepares ────────────────────────────────────────────────

    def _alice_prepare(self) -> tuple:
        """
        Generate Alice's random bits and random bases.

        Basis encoding:
          0 = rectilinear  (+) : |0⟩ or |1⟩
          1 = diagonal     (×) : |+⟩ or |−⟩
        """
        bits  = self.rng.integers(0, 2, self.num_qubits).tolist()
        bases = self.rng.integers(0, 2, self.num_qubits).tolist()
        return bits, bases

    # ── Step 2: Bob chooses bases ─────────────────────────────────────────────

    def _bob_choose_bases(self) -> list:
        """Bob independently picks random measurement bases."""
        return self.rng.integers(0, 2, self.num_qubits).tolist()

    # ── Step 3: Build and run the quantum circuit ─────────────────────────────

    def _run_quantum_circuit(
        self,
        alice_bits:  list,
        alice_bases: list,
        bob_bases:   list,
    ) -> list:
        """
        Build a single QuantumCircuit with all N qubits, simulate it through
        the Aer backend (with optional noise model), and return Bob's outcomes.

        Circuit structure per qubit i:
          [Alice encodes] → [quantum channel w/ noise] → [Bob measures]

        Encoding:
          bit=0, basis=0  → |0⟩             (do nothing — starts as |0⟩)
          bit=1, basis=0  → |1⟩             (apply X)
          bit=0, basis=1  → |+⟩             (apply H)
          bit=1, basis=1  → |−⟩             (apply X then H)

        Bob measurement:
          basis=0  → measure in Z-basis     (do nothing before measure)
          basis=1  → measure in X-basis     (apply H before measure)
        """
        n  = self.num_qubits
        qc = QuantumCircuit(n, n)

        # Alice encodes
        for i in range(n):
            if alice_bits[i] == 1:
                qc.x(i)           # Flip to |1⟩
            if alice_bases[i] == 1:
                qc.h(i)           # Rotate to diagonal basis

        # Bob decodes (applies H in diagonal basis before measuring)
        for i in range(n):
            if bob_bases[i] == 1:
                qc.h(i)           # Rotate back to rectilinear for measurement

        # Barrier for clarity (does not affect simulation)
        qc.barrier()
        qc.measure(range(n), range(n))

        # Transpile for the Aer backend (required in Qiskit 2.x)
        transpiled = transpile(
            qc,
            optimization_level=0
        )

        # Run with shots=1 (single transmission — BB84 is a one-shot protocol)
        job    = self._backend.run(transpiled, shots=1)
        result = job.result()
        counts = result.get_counts()

        # Extract the single bitstring result
        # Qiskit returns bitstrings as MSB-first strings, e.g. "01101..."
        # We need to reverse to get LSB-first (qubit 0 = index 0)
        bitstring = list(counts.keys())[0].replace(" ", "")
        bob_bits  = [int(b) for b in reversed(bitstring)]

        return bob_bits

    # ── Full protocol runner ──────────────────────────────────────────────────

    def run(self) -> BB84Result:
        """
        Execute the complete BB84 protocol and return a BB84Result.

        Raises
        ------
        RuntimeError
            If QBER exceeds the security threshold (possible eavesdropper).
        """
        t_start = time.perf_counter()
        result  = BB84Result(
            num_qubits    = self.num_qubits,
            noise_enabled = self.noise_enabled,
        )

        # ── 1. Alice prepares ─────────────────────────────────────────────────
        alice_bits, alice_bases = self._alice_prepare()
        result.alice_bits  = alice_bits
        result.alice_bases = alice_bases
        result.raw_key_length = self.num_qubits

        # ── 2. Bob chooses ────────────────────────────────────────────────────
        bob_bases = self._bob_choose_bases()
        result.bob_bases = bob_bases

        # ── 3. Quantum circuit simulation ─────────────────────────────────────
        bob_bits = self._run_quantum_circuit(alice_bits, alice_bases, bob_bases)
        result.bob_bits = bob_bits

        # ── 4. Sifting ────────────────────────────────────────────────────────
        matching_idx, alice_sifted, bob_sifted = sift_keys(
            alice_bits, alice_bases, bob_bits, bob_bases
        )
        result.matching_indices  = matching_idx
        result.alice_sifted      = alice_sifted
        result.bob_sifted        = bob_sifted
        result.sifted_key_length = len(alice_sifted)

        if result.sifted_key_length > 0:
            result.sifting_efficiency = (
                result.sifted_key_length / result.raw_key_length
            )

        # ── 5. QBER estimation ────────────────────────────────────────────────
        qber, alice_rem, bob_rem = estimate_qber(
            alice_sifted, bob_sifted, sample_fraction=0.20
        )
        result.qber      = qber
        result.qber_safe = qber < self.QBER_ABORT_THRESHOLD

        if not result.qber_safe:
            # QBER too high — possible eavesdropper or channel too noisy
            # We still return the result so the UI can display the error;
            # the final_key_bytes will be OS-random as an emergency fallback.
            result.final_key_bytes = b""
            result.final_key_hex   = ""
            result.simulation_time_ms = (time.perf_counter() - t_start) * 1000
            result.bloch_vectors = bits_to_bloch_vectors(alice_bits, alice_bases)
            return result

        # ── 6. Error reconciliation ───────────────────────────────────────────
        alice_rec, bob_rec = reconcile_errors(alice_rem, bob_rem, block_size=8)
        result.alice_reconciled = alice_rec
        result.bob_reconciled   = bob_rec

        # ── 7. Privacy amplification ──────────────────────────────────────────
        final_key = privacy_amplification(alice_rec, target_bytes=32)
        result.final_key_bytes  = final_key
        result.final_key_hex    = final_key.hex()
        result.key_hex_preview  = final_key.hex()[:16] + "..."
        result.final_key_length = len(final_key) * 8  # in bits

        # ── 8. Bloch sphere data for visualisation ────────────────────────────
        result.bloch_vectors = bits_to_bloch_vectors(alice_bits, alice_bases)

        result.simulation_time_ms = (time.perf_counter() - t_start) * 1000
        return result


# ─────────────────────────────────────────────────────────────────────────────
# Convenience function (used by Flask routes)
# ─────────────────────────────────────────────────────────────────────────────

def run_bb84(
    num_qubits:     int   = 256,
    noise_enabled:  bool  = True,
    depolar_prob:   float = 0.02,
    readout_err:    float = 0.01,
    eavesdrop_prob: float = 0.0,
) -> BB84Result:
    """
    One-shot convenience wrapper: create BB84Protocol, run, return result.
    Flask routes call this directly.
    """
    protocol = BB84Protocol(
        num_qubits     = num_qubits,
        noise_enabled  = noise_enabled,
        depolar_prob   = depolar_prob,
        readout_err    = readout_err,
        eavesdrop_prob = eavesdrop_prob,
    )
    return protocol.run()


# ── Smoke-test ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Running BB84 smoke test (128 qubits, noise ON)...")
    res = run_bb84(num_qubits=128, noise_enabled=True)
    print(f"  Raw qubits      : {res.raw_key_length}")
    print(f"  Sifted bits     : {res.sifted_key_length}")
    print(f"  QBER            : {res.qber:.4f} ({'SAFE' if res.qber_safe else 'UNSAFE'})")
    print(f"  Final key (hex) : {res.key_hex_preview}")
    print(f"  Bloch vectors   : {res.bloch_vectors[:2]}")
    print(f"  Time            : {res.simulation_time_ms:.1f} ms")
    print("Smoke test PASSED.")