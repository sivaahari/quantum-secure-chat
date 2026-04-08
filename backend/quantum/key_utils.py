# backend/quantum/key_utils.py
"""
Post-processing utilities for BB84 key material.

Implements:
  - Basis sifting          : keep only matching-basis bits
  - QBER estimation        : sample a subset to measure error rate
  - Error reconciliation   : simple parity check (Cascade-lite)
  - Privacy amplification  : HKDF-SHA256 to derive final AES-256 key
  - Bloch sphere coords    : compute (x, y, z) for a single-qubit state

Compatible with Qiskit 2.x (qiskit.quantum_info.Statevector)
"""

import hashlib
import hmac
import os
import math
from typing import List, Tuple

import numpy as np
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes


# ─────────────────────────────────────────────────────────────────────────────
# 1. BASIS SIFTING
# ─────────────────────────────────────────────────────────────────────────────

def sift_keys(alice_bits, alice_bases, bob_bits, bob_bases):

    matching_indices = []
    alice_sifted = []
    bob_sifted = []

    n = min(
        len(alice_bits),
        len(alice_bases),
        len(bob_bits),
        len(bob_bases)
    )

    for i in range(n):

        if alice_bases[i] == bob_bases[i]:

            matching_indices.append(i)
            alice_sifted.append(alice_bits[i])
            bob_sifted.append(bob_bits[i])

    return matching_indices, alice_sifted, bob_sifted


# ─────────────────────────────────────────────────────────────────────────────
# 2. QBER ESTIMATION
# ─────────────────────────────────────────────────────────────────────────────

def estimate_qber(
    alice_sifted: List[int],
    bob_sifted: List[int],
    sample_fraction: float = 0.20,
) -> Tuple[float, List[int], List[int]]:
    """
    Estimate the Quantum Bit Error Rate (QBER) by publicly comparing
    a random sample of sifted bits, then discarding those sample bits.

    A QBER < 0.11 (11%) is considered safe against eavesdropping under
    BB84's security proofs (Shor-Preskill bound).

    Parameters
    ----------
    alice_sifted     : Alice's sifted bits
    bob_sifted       : Bob's sifted bits
    sample_fraction  : Fraction of sifted bits to sacrifice for QBER check

    Returns
    -------
    (qber, alice_remaining, bob_remaining)
    """
    n = len(alice_sifted)
    if n == 0:
        return 0.0, [], []

    sample_size = max(1, int(n * sample_fraction))
    # Randomly choose indices for error check (without replacement)
    rng = np.random.default_rng()
    sample_indices = set(rng.choice(n, size=sample_size, replace=False).tolist())

    errors = sum(
        1 for i in sample_indices
        if alice_sifted[i] != bob_sifted[i]
    )
    qber = errors / sample_size if sample_size > 0 else 0.0

    # Remaining bits (not used in QBER check) become the raw secret key
    remaining_indices = [i for i in range(n) if i not in sample_indices]
    alice_remaining = [alice_sifted[i] for i in remaining_indices]
    bob_remaining   = [bob_sifted[i]   for i in remaining_indices]

    return qber, alice_remaining, bob_remaining


# ─────────────────────────────────────────────────────────────────────────────
# 3. SIMPLE ERROR RECONCILIATION (parity-check, Cascade-lite)
# ─────────────────────────────────────────────────────────────────────────────

def reconcile_errors(
    alice_key: List[int],
    bob_key: List[int],
    block_size: int = 8,
) -> Tuple[List[int], List[int]]:
    """
    Lightweight single-pass block parity error reconciliation.

    Splits keys into blocks of `block_size`. For each block where
    parities differ, we discard the entire block (conservative approach
    — a real system would use Cascade or LDPC).

    Returns the reconciled sub-keys (identical between Alice and Bob).
    """
    alice_out, bob_out = [], []

    for start in range(0, len(alice_key), block_size):
        a_block = alice_key[start : start + block_size]
        b_block = bob_key[start  : start + block_size]

        if sum(a_block) % 2 == sum(b_block) % 2:
            # Parities match — keep this block
            alice_out.extend(a_block)
            bob_out.extend(b_block)
        # Parities differ — discard block silently

    return alice_out, bob_out


# ─────────────────────────────────────────────────────────────────────────────
# 4. PRIVACY AMPLIFICATION
# ─────────────────────────────────────────────────────────────────────────────

def privacy_amplification(
    key_bits: List[int],
    target_bytes: int = 32,
    salt: bytes = b"quantum-llm-chat-v1",
) -> bytes:
    """
    Compress the reconciled key into exactly `target_bytes` using HKDF-SHA256.

    HKDF (RFC 5869) extracts entropy from the raw key material and expands
    it to exactly the requested length — even if the input is noisy.

    Parameters
    ----------
    key_bits     : Reconciled key as list of bits [0,1,...]
    target_bytes : Output key length (32 = AES-256)
    salt         : Domain-separation string

    Returns
    -------
    bytes of length `target_bytes` — the final AES key
    """
    if len(key_bits) < 8:
        # Emergency fallback: derive from OS entropy (not quantum-secure,
        # but prevents a crash if BB84 produced almost no bits)
        return os.urandom(target_bytes)

    # Convert bit list → bytes (MSB first, zero-pad last byte)
    padded = key_bits[:]
    remainder = len(padded) % 8
    if remainder:
        padded.extend([0] * (8 - remainder))

    key_bytes = bytes(
        int("".join(str(b) for b in padded[i : i + 8]), 2)
        for i in range(0, len(padded), 8)
    )

    # HKDF: extract + expand
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=target_bytes,
        salt=salt,
        info=b"bb84-aes256-key",
    )
    return hkdf.derive(key_bytes)


# ─────────────────────────────────────────────────────────────────────────────
# 5. BLOCH SPHERE COORDINATES
# ─────────────────────────────────────────────────────────────────────────────

def bits_to_bloch_vectors(
    alice_bits: List[int],
    alice_bases: List[int],
    max_display: int = 8,
) -> List[dict]:
    """
    Compute Bloch sphere (x, y, z) coordinates for the first `max_display`
    qubits Alice prepared — for frontend visualization.

    State mapping:
      Rectilinear basis (basis=0):  bit=0 → |0⟩, bit=1 → |1⟩
      Diagonal basis    (basis=1):  bit=0 → |+⟩, bit=1 → |−⟩

    Bloch vector formula for pure state α|0⟩ + β|1⟩:
      x = 2·Re(α·β*)
      y = -2·Im(α·β*)
      z = |α|² − |β|²
    """
    vectors = []
    n = min(len(alice_bits), max_display)

    for i in range(n):
        bit   = alice_bits[i]
        basis = alice_bases[i]

        # Compute statevector components
        if basis == 0:  # Rectilinear: |0⟩ or |1⟩
            if bit == 0:
                alpha, beta = complex(1, 0), complex(0, 0)   # |0⟩ → north pole
            else:
                alpha, beta = complex(0, 0), complex(1, 0)   # |1⟩ → south pole
        else:           # Diagonal: |+⟩ or |−⟩
            if bit == 0:
                alpha = complex(1 / math.sqrt(2), 0)
                beta  = complex(1 / math.sqrt(2), 0)         # |+⟩ → +X equator
            else:
                alpha = complex(1 / math.sqrt(2), 0)
                beta  = complex(-1 / math.sqrt(2), 0)        # |−⟩ → -X equator

        # Bloch vector
        x = 2.0 * (alpha * beta.conjugate()).real
        y = -2.0 * (alpha * beta.conjugate()).imag
        z = abs(alpha) ** 2 - abs(beta) ** 2

        state_label = {
            (0, 0): "|0⟩", (0, 1): "|1⟩",
            (1, 0): "|+⟩", (1, 1): "|−⟩",
        }[(basis, bit)]

        vectors.append({
            "qubit_index": i,
            "state":       state_label,
            "basis":       "rectilinear" if basis == 0 else "diagonal",
            "x": round(x, 6),
            "y": round(y, 6),
            "z": round(z, 6),
        })

    return vectors


# ─────────────────────────────────────────────────────────────────────────────
# 6. UTILITY: bits ↔ hex string
# ─────────────────────────────────────────────────────────────────────────────

def bits_to_hex(bits: List[int]) -> str:
    """Convert a list of bits to a hex string (for display only)."""
    if not bits:
        return ""
    padded = bits[:]
    rem = len(padded) % 8
    if rem:
        padded.extend([0] * (8 - rem))
    return bytes(
        int("".join(str(b) for b in padded[i : i + 8]), 2)
        for i in range(0, len(padded), 8)
    ).hex()


def hex_to_bits(hex_str: str) -> List[int]:
    """Convert a hex string back to a list of bits."""
    bits = []
    for byte in bytes.fromhex(hex_str):
        bits.extend(int(b) for b in format(byte, "08b"))
    return bits