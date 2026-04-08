# backend/quantum/__init__.py
"""
Quantum module public API.
Import BB84 functionality from here in Flask routes.
"""

from .bb84 import BB84Protocol, BB84Result, run_bb84
from .noise_model import build_noise_model, get_noise_summary
from .key_utils import (
    sift_keys,
    estimate_qber,
    reconcile_errors,
    privacy_amplification,
    bits_to_bloch_vectors,
    bits_to_hex,
)

__all__ = [
    "BB84Protocol",
    "BB84Result",
    "run_bb84",
    "build_noise_model",
    "get_noise_summary",
    "sift_keys",
    "estimate_qber",
    "reconcile_errors",
    "privacy_amplification",
    "bits_to_bloch_vectors",
    "bits_to_hex",
]