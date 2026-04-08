# backend/quantum/noise_model.py
"""
Qiskit Aer noise model for BB84 quantum channel simulation.

Models realistic quantum noise sources:
  - Depolarizing error on single-qubit gates (H, X)
  - Depolarizing error on two-qubit gates (unused in BB84 but included for extensibility)
  - Readout (measurement) bitflip error — simulates detector imperfections

Compatible with Qiskit 2.x + qiskit-aer 0.17.x
"""

from qiskit_aer.noise import (
    NoiseModel,
    depolarizing_error,
    ReadoutError,
)
import numpy as np
import sys
import os

# Allow running this file directly for quick testing
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


def build_noise_model(
    depolar_prob: float = 0.02,
    readout_error_prob: float = 0.01,
    eavesdrop_prob: float = 0.0,
) -> NoiseModel:
    """
    Build and return a Qiskit Aer NoiseModel for the BB84 channel.

    Parameters
    ----------
    depolar_prob : float
        Depolarizing error probability per gate (0.0 – 1.0).
        Real optical fibre channels: ~0.01–0.05.
    readout_error_prob : float
        Probability that a correct measurement is flipped (detector noise).
        Typical SNSPD detectors: ~0.001–0.01.
    eavesdrop_prob : float
        Extra bit-flip probability to simulate an eavesdropper (Eve).
        Eve intercept-resend attack adds ~25% QBER; use 0.25 to simulate.

    Returns
    -------
    NoiseModel
        Configured Aer noise model ready to attach to AerSimulator.
    """
    noise_model = NoiseModel()

    # ── Single-qubit gate depolarizing error ─────────────────────────────────
    # Depolarizing channel: with probability p, apply random Pauli (X, Y, or Z)
    if depolar_prob > 0.0:
        single_qubit_error = depolarizing_error(depolar_prob, 1)
        # Apply to Hadamard and Pauli-X (the only gates used in BB84)
        noise_model.add_all_qubit_quantum_error(single_qubit_error, ["h", "x"])

    # ── Measurement (readout) bitflip error ──────────────────────────────────
    # ReadoutError([[p(0|0), p(1|0)], [p(0|1), p(1|1)]])
    # p(1|0) = probability of reading 1 when actual state is |0⟩
    # p(0|1) = probability of reading 0 when actual state is |1⟩
    total_readout_err = readout_error_prob + eavesdrop_prob
    total_readout_err = min(total_readout_err, 0.5)  # cap at 50%

    if total_readout_err > 0.0:
        readout_err = ReadoutError(
            [
                [1.0 - total_readout_err, total_readout_err],   # state |0⟩
                [total_readout_err, 1.0 - total_readout_err],   # state |1⟩
            ]
        )
        noise_model.add_all_qubit_readout_error(readout_err)

    return noise_model


def get_noise_summary(noise_model: NoiseModel) -> dict:
    """
    Return a human-readable summary of the noise model for API responses.
    """
    return {
        "basis_gates": noise_model.basis_gates,
        "noise_qubits": list(noise_model.noise_qubits) if noise_model.noise_qubits else [],
        "description": (
            "Depolarizing gate noise + readout bitflip error "
            "simulating a realistic optical fibre quantum channel."
        ),
    }


# ── Quick smoke-test ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    nm = build_noise_model(depolar_prob=0.02, readout_error_prob=0.01)
    print("Noise model built successfully.")
    print("Basis gates:", nm.basis_gates)