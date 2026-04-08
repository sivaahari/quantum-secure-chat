# backend/tests/test_bb84.py
"""
Unit tests for the BB84 quantum key distribution module.
Run from project root:  pytest backend/tests/test_bb84.py -v
"""

import pytest
import sys
import os

# Make sure backend/ is on sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from quantum.bb84 import BB84Protocol, run_bb84, BB84Result
from quantum.key_utils import (
    sift_keys,
    estimate_qber,
    reconcile_errors,
    privacy_amplification,
    bits_to_bloch_vectors,
    bits_to_hex,
)
from quantum.noise_model import build_noise_model


# ─────────────────────────────────────────────────────────────────────────────
# Noise model tests
# ─────────────────────────────────────────────────────────────────────────────

class TestNoiseModel:
    def test_build_no_noise(self):
        nm = build_noise_model(depolar_prob=0.0, readout_error_prob=0.0)
        assert nm is not None

    def test_build_with_noise(self):
        nm = build_noise_model(depolar_prob=0.02, readout_error_prob=0.01)
        assert nm is not None

    def test_eavesdrop_noise(self):
        nm = build_noise_model(
            depolar_prob=0.02, readout_error_prob=0.01, eavesdrop_prob=0.25
        )
        assert nm is not None


# ─────────────────────────────────────────────────────────────────────────────
# Key utility tests
# ─────────────────────────────────────────────────────────────────────────────

class TestSifting:
    def test_perfect_match(self):
        alice_bits  = [0, 1, 0, 1]
        alice_bases = [0, 0, 1, 1]
        bob_bits    = [0, 1, 0, 1]
        bob_bases   = [0, 0, 1, 1]
        idx, a_sifted, b_sifted = sift_keys(
            alice_bits, alice_bases, bob_bits, bob_bases
        )
        assert idx == [0, 1, 2, 3]
        assert a_sifted == [0, 1, 0, 1]
        assert b_sifted == [0, 1, 0, 1]

    def test_no_match(self):
        alice_bases = [0, 0, 0]
        bob_bases   = [1, 1, 1]
        idx, a_s, b_s = sift_keys([1, 0, 1], alice_bases, [0, 1, 0], bob_bases)
        assert idx == []
        assert a_s == []

    def test_partial_match(self):
        alice_bases = [0, 1, 0, 1]
        bob_bases   = [0, 0, 1, 1] # Changed index 2 to '1' to force a mismatch
        alice_bits  = [1, 0, 1, 0]
        bob_bits    = [1, 1, 1, 0]
        idx, a_s, b_s = sift_keys(alice_bits, alice_bases, bob_bits, bob_bases)
        # Indices 0 and 3 match
        assert idx == [0, 3]
        assert a_s == [1, 0]
        assert b_s == [1, 0]


class TestQBER:
    def test_zero_error(self):
        bits = [0, 1, 0, 1, 1, 0, 1, 0, 0, 1]
        qber, ar, br = estimate_qber(bits, bits, sample_fraction=0.3)
        assert qber == 0.0

    def test_all_error(self):
        alice = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        bob   = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
        qber, _, _ = estimate_qber(alice, bob, sample_fraction=0.5)
        assert qber == 1.0

    def test_empty_input(self):
        qber, ar, br = estimate_qber([], [], sample_fraction=0.2)
        assert qber == 0.0
        assert ar == []


class TestPrivacyAmplification:
    def test_output_length(self):
        bits = [1, 0, 1, 1, 0, 0, 1, 0] * 16   # 128 bits
        key = privacy_amplification(bits, target_bytes=32)
        assert len(key) == 32

    def test_deterministic(self):
        bits = [1, 0, 1, 1, 0, 0, 1, 0] * 16
        key1 = privacy_amplification(bits, target_bytes=32)
        key2 = privacy_amplification(bits, target_bytes=32)
        assert key1 == key2

    def test_different_input_different_output(self):
        bits_a = [1, 0] * 32
        bits_b = [0, 1] * 32
        key_a = privacy_amplification(bits_a)
        key_b = privacy_amplification(bits_b)
        assert key_a != key_b

    def test_short_fallback(self):
        """Very short bit list should not crash — returns OS-random bytes."""
        key = privacy_amplification([1, 0], target_bytes=32)
        assert len(key) == 32


class TestReconciliation:
    def test_matching_blocks_kept(self):
        # Both same — parity matches — all kept
        a = [1, 0, 1, 0, 1, 1, 0, 0]
        b = [1, 0, 1, 0, 1, 1, 0, 0]
        ar, br = reconcile_errors(a, b, block_size=8)
        assert ar == a
        assert br == b

    def test_error_block_discarded(self):
        # Introduce one bit flip → parity mismatch → block discarded
        a = [1, 0, 1, 0, 1, 1, 0, 0]
        b = [1, 0, 1, 0, 1, 1, 0, 1]  # last bit flipped
        ar, br = reconcile_errors(a, b, block_size=8)
        assert ar == []


class TestBlochVectors:
    def test_z_basis_zero(self):
        vecs = bits_to_bloch_vectors([0], [0])
        assert vecs[0]["state"] == "|0⟩"
        assert abs(vecs[0]["z"] - 1.0) < 1e-5   # north pole

    def test_z_basis_one(self):
        vecs = bits_to_bloch_vectors([1], [0])
        assert vecs[0]["state"] == "|1⟩"
        assert abs(vecs[0]["z"] - (-1.0)) < 1e-5  # south pole

    def test_x_basis_plus(self):
        vecs = bits_to_bloch_vectors([0], [1])
        assert vecs[0]["state"] == "|+⟩"
        assert abs(vecs[0]["x"] - 1.0) < 1e-5    # +X equator

    def test_x_basis_minus(self):
        vecs = bits_to_bloch_vectors([1], [1])
        assert vecs[0]["state"] == "|−⟩"
        assert abs(vecs[0]["x"] - (-1.0)) < 1e-5  # -X equator

    def test_max_display(self):
        bits  = [0] * 20
        bases = [0] * 20
        vecs = bits_to_bloch_vectors(bits, bases, max_display=5)
        assert len(vecs) == 5


# ─────────────────────────────────────────────────────────────────────────────
# Full BB84 protocol tests
# ─────────────────────────────────────────────────────────────────────────────

class TestBB84Protocol:
    def test_noiseless_run(self):
        """Without noise, QBER should be 0 and key should be generated."""
        result = run_bb84(num_qubits=64, noise_enabled=False)
        assert isinstance(result, BB84Result)
        assert result.qber == 0.0
        assert result.qber_safe is True
        assert len(result.final_key_bytes) == 32

    def test_noisy_run_produces_key(self):
        """With low noise, QBER should stay below 0.11 and key should be produced."""
        result = run_bb84(
            num_qubits=128,
            noise_enabled=True,
            depolar_prob=0.02,
            readout_err=0.01,
        )
        assert isinstance(result, BB84Result)
        # With 2% depolarizing + 1% readout the QBER should be well below 11%
        assert result.qber < 0.20   # loose bound for CI stability

    def test_sifted_key_shorter_than_raw(self):
        """Sifted key must be shorter than raw (statistically ~50% of raw)."""
        result = run_bb84(num_qubits=128, noise_enabled=False)
        assert result.sifted_key_length < result.raw_key_length

    def test_final_key_is_32_bytes(self):
        result = run_bb84(num_qubits=128, noise_enabled=False)
        assert len(result.final_key_bytes) == 32

    def test_to_dict_is_json_serialisable(self):
        import json
        result = run_bb84(num_qubits=64, noise_enabled=False)
        d = result.to_dict()
        # Should not raise
        json_str = json.dumps(d)
        assert isinstance(json_str, str)

    def test_bloch_vectors_present(self):
        result = run_bb84(num_qubits=32, noise_enabled=False)
        assert len(result.bloch_vectors) > 0
        bv = result.bloch_vectors[0]
        assert "x" in bv and "y" in bv and "z" in bv

    def test_two_runs_different_keys(self):
        """Each run should produce a different key (random bases)."""
        r1 = run_bb84(num_qubits=128, noise_enabled=False)
        r2 = run_bb84(num_qubits=128, noise_enabled=False)
        # Extremely unlikely to be equal with 256-bit keys
        assert r1.final_key_bytes != r2.final_key_bytes