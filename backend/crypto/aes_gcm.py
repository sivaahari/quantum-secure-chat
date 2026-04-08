# backend/crypto/aes_gcm.py
"""
AES-256-GCM authenticated encryption wrapper.

Why AES-256-GCM?
  - 256-bit key  → post-quantum safe margin (Grover's halves to 128-bit security)
  - GCM mode     → provides both confidentiality AND authenticity (AEAD)
  - 96-bit nonce → NIST recommended length for GCM
  - Auth tag     → 128-bit tag detects any tampering

Usage:
    from crypto.aes_gcm import AESCipher
    cipher    = AESCipher(key_bytes_32)
    encrypted = cipher.encrypt("hello")   # returns EncryptedPayload
    plaintext = cipher.decrypt(encrypted) # returns "hello"
"""

import os
import base64
import json
import time
from dataclasses import dataclass, asdict
from typing import Union

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# ─────────────────────────────────────────────────────────────────────────────
# Data container for wire-format encrypted messages
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class EncryptedPayload:
    """
    Self-contained encrypted message suitable for JSON transport.

    Fields
    ------
    nonce_b64   : base64-encoded 12-byte random nonce
    ciphertext_b64 : base64-encoded ciphertext + 16-byte GCM auth tag
    timestamp   : Unix epoch float — used to detect replay attacks
    key_version : Integer tag identifying which BB84 key was used
                  (increments every KEY_REFRESH_EVERY messages)
    """
    nonce_b64:      str
    ciphertext_b64: str
    timestamp:      float
    key_version:    int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @classmethod
    def from_dict(cls, d: dict) -> "EncryptedPayload":
        return cls(
            nonce_b64      = d["nonce_b64"],
            ciphertext_b64 = d["ciphertext_b64"],
            timestamp      = float(d["timestamp"]),
            key_version    = int(d.get("key_version", 0)),
        )

    @classmethod
    def from_json(cls, json_str: str) -> "EncryptedPayload":
        return cls.from_dict(json.loads(json_str))


# ─────────────────────────────────────────────────────────────────────────────
# AES-256-GCM cipher class
# ─────────────────────────────────────────────────────────────────────────────

class AESCipher:
    """
    AES-256-GCM encrypt / decrypt with automatic nonce generation.

    Parameters
    ----------
    key : bytes
        Exactly 32 bytes (256 bits). Typically the output of BB84
        privacy_amplification(). Never reuse the same key+nonce pair.

    key_version : int
        Monotonically increasing counter — which BB84 round produced this key.
        Embedded in every EncryptedPayload for receiver to identify the key.
    """

    NONCE_BYTES = 12    # 96-bit nonce — NIST SP 800-38D recommendation
    TAG_BYTES   = 16    # 128-bit authentication tag (GCM default)
    KEY_BYTES   = 32    # 256-bit key

    def __init__(self, key: bytes, key_version: int = 0):
        if len(key) != self.KEY_BYTES:
            raise ValueError(
                f"AES-256 requires exactly 32 bytes; got {len(key)}"
            )
        self._aesgcm      = AESGCM(key)
        self.key_version  = key_version
        self._key_preview = key.hex()[:16] + "..."  # safe for logging

    # ── Encryption ────────────────────────────────────────────────────────────

    def encrypt(
        self,
        plaintext: Union[str, bytes],
        associated_data: bytes = b"quantum-llm-chat",
    ) -> EncryptedPayload:
        """
        Encrypt plaintext using AES-256-GCM.

        Parameters
        ----------
        plaintext       : str or bytes to encrypt
        associated_data : Additional authenticated data (AAD).
                          Not encrypted but authenticated — tampering with AAD
                          causes decryption to fail. We use a fixed app tag.

        Returns
        -------
        EncryptedPayload  (nonce + ciphertext+tag, base64-encoded)
        """
        if isinstance(plaintext, str):
            plaintext = plaintext.encode("utf-8")

        # Generate a cryptographically random nonce (NEVER reuse with same key)
        nonce = os.urandom(self.NONCE_BYTES)

        # AESGCM.encrypt() appends the 16-byte auth tag to the ciphertext
        ciphertext_with_tag = self._aesgcm.encrypt(
            nonce, plaintext, associated_data
        )

        return EncryptedPayload(
            nonce_b64      = base64.b64encode(nonce).decode(),
            ciphertext_b64 = base64.b64encode(ciphertext_with_tag).decode(),
            timestamp      = time.time(),
            key_version    = self.key_version,
        )

    # ── Decryption ────────────────────────────────────────────────────────────

    def decrypt(
        self,
        payload: Union[EncryptedPayload, dict],
        associated_data: bytes = b"quantum-llm-chat",
        max_age_seconds: float = 300.0,
    ) -> str:
        """
        Decrypt and authenticate an EncryptedPayload.

        Parameters
        ----------
        payload         : EncryptedPayload or dict from JSON
        associated_data : Must match what was used during encryption
        max_age_seconds : Reject messages older than this (replay protection)

        Returns
        -------
        str  — decrypted plaintext

        Raises
        ------
        ValueError   — invalid payload structure
        cryptography.exceptions.InvalidTag — authentication failed (tampering!)
        TimeoutError — message too old (replay attack)
        """
        if isinstance(payload, dict):
            payload = EncryptedPayload.from_dict(payload)

        # Replay attack protection
        age = time.time() - payload.timestamp
        if age > max_age_seconds:
            raise TimeoutError(
                f"Message too old ({age:.1f}s > {max_age_seconds}s) — "
                "possible replay attack."
            )

        nonce           = base64.b64decode(payload.nonce_b64)
        ciphertext_tag  = base64.b64decode(payload.ciphertext_b64)

        # AESGCM.decrypt() raises InvalidTag if tag doesn't match
        plaintext_bytes = self._aesgcm.decrypt(
            nonce, ciphertext_tag, associated_data
        )
        return plaintext_bytes.decode("utf-8")

    # ── Helpers ───────────────────────────────────────────────────────────────

    @property
    def key_preview(self) -> str:
        """Safe truncated hex of key for logging (never log full key)."""
        return self._key_preview

    def __repr__(self) -> str:
        return (
            f"AESCipher(key_version={self.key_version}, "
            f"key_preview={self._key_preview})"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Module-level convenience functions
# ─────────────────────────────────────────────────────────────────────────────

def encrypt_message(
    key: bytes,
    plaintext: str,
    key_version: int = 0,
) -> dict:
    """
    One-shot encrypt — returns JSON-ready dict.
    Used by SocketIO event handlers.
    """
    cipher = AESCipher(key, key_version=key_version)
    payload = cipher.encrypt(plaintext)
    return payload.to_dict()


def decrypt_message(
    key: bytes,
    payload_dict: dict,
) -> str:
    """
    One-shot decrypt — accepts JSON dict from SocketIO event.
    Used by SocketIO event handlers.
    """
    cipher = AESCipher(key, key_version=payload_dict.get("key_version", 0))
    return cipher.decrypt(payload_dict)


# ── Smoke test ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import os as _os
    test_key = _os.urandom(32)
    cipher   = AESCipher(test_key, key_version=1)

    original  = "Hello, Quantum World! 🔐"
    encrypted = cipher.encrypt(original)
    decrypted = cipher.decrypt(encrypted)

    print(f"Original  : {original}")
    print(f"Encrypted : {encrypted.ciphertext_b64[:40]}...")
    print(f"Decrypted : {decrypted}")
    print(f"Match     : {original == decrypted}")
    assert original == decrypted
    print("AES-GCM smoke test PASSED.")