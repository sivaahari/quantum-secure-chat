# backend/tests/test_aes.py
"""
Unit tests for AES-256-GCM encryption module.
Run: pytest backend/tests/test_aes.py -v
"""

import os
import sys
import time
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from crypto.aes_gcm import (
    AESCipher,
    EncryptedPayload,
    encrypt_message,
    decrypt_message,
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def key32():
    return os.urandom(32)

@pytest.fixture
def cipher(key32):
    return AESCipher(key32, key_version=1)


# ─────────────────────────────────────────────────────────────────────────────
# AESCipher construction
# ─────────────────────────────────────────────────────────────────────────────

class TestAESCipherConstruction:
    def test_valid_key(self, key32):
        c = AESCipher(key32)
        assert c is not None

    def test_wrong_key_length_raises(self):
        with pytest.raises(ValueError, match="32 bytes"):
            AESCipher(b"tooshort")

    def test_key_version_stored(self, key32):
        c = AESCipher(key32, key_version=7)
        assert c.key_version == 7

    def test_key_preview_safe(self, key32):
        c = AESCipher(key32)
        assert "..." in c.key_preview
        assert len(c.key_preview) < 64   # never leaks full key


# ─────────────────────────────────────────────────────────────────────────────
# Encryption
# ─────────────────────────────────────────────────────────────────────────────

class TestEncryption:
    def test_returns_encrypted_payload(self, cipher):
        p = cipher.encrypt("hello")
        assert isinstance(p, EncryptedPayload)

    def test_nonce_is_base64(self, cipher):
        import base64
        p = cipher.encrypt("test")
        decoded = base64.b64decode(p.nonce_b64)
        assert len(decoded) == 12    # 96-bit nonce

    def test_ciphertext_different_from_plaintext(self, cipher):
        plaintext = "Hello, Quantum World!"
        p = cipher.encrypt(plaintext)
        assert plaintext not in p.ciphertext_b64

    def test_two_encryptions_different_nonces(self, cipher):
        p1 = cipher.encrypt("same text")
        p2 = cipher.encrypt("same text")
        assert p1.nonce_b64 != p2.nonce_b64   # random nonce each time

    def test_two_encryptions_different_ciphertext(self, cipher):
        p1 = cipher.encrypt("same text")
        p2 = cipher.encrypt("same text")
        assert p1.ciphertext_b64 != p2.ciphertext_b64

    def test_encrypt_bytes_input(self, cipher):
        p = cipher.encrypt(b"bytes input")
        assert isinstance(p, EncryptedPayload)

    def test_key_version_in_payload(self, key32):
        c = AESCipher(key32, key_version=42)
        p = c.encrypt("test")
        assert p.key_version == 42

    def test_timestamp_is_recent(self, cipher):
        before = time.time()
        p = cipher.encrypt("test")
        after  = time.time()
        assert before <= p.timestamp <= after


# ─────────────────────────────────────────────────────────────────────────────
# Decryption
# ─────────────────────────────────────────────────────────────────────────────

class TestDecryption:
    def test_roundtrip_string(self, cipher):
        original = "Hello, Quantum World! 🔐"
        encrypted = cipher.encrypt(original)
        decrypted = cipher.decrypt(encrypted)
        assert decrypted == original

    def test_roundtrip_long_message(self, cipher):
        original = "A" * 10_000
        enc = cipher.encrypt(original)
        assert cipher.decrypt(enc) == original

    def test_roundtrip_unicode(self, cipher):
        original = "量子暗号 🔑 Κβαντική κρυπτογραφία"
        enc = cipher.encrypt(original)
        assert cipher.decrypt(enc) == original

    def test_decrypt_from_dict(self, cipher):
        enc = cipher.encrypt("from dict")
        d   = enc.to_dict()
        assert cipher.decrypt(d) == "from dict"

    def test_tampered_ciphertext_raises(self, cipher):
        from cryptography.exceptions import InvalidTag
        enc   = cipher.encrypt("secret")
        d     = enc.to_dict()
        # Corrupt one byte of ciphertext
        import base64
        ct    = base64.b64decode(d["ciphertext_b64"])
        ct    = bytes([ct[0] ^ 0xFF]) + ct[1:]
        d["ciphertext_b64"] = base64.b64encode(ct).decode()
        with pytest.raises(InvalidTag):
            cipher.decrypt(d)

    def test_wrong_key_raises(self, key32):
        c1 = AESCipher(key32)
        c2 = AESCipher(os.urandom(32))
        enc = c1.encrypt("secret")
        from cryptography.exceptions import InvalidTag
        with pytest.raises(InvalidTag):
            c2.decrypt(enc)

    def test_expired_message_raises(self, cipher):
        enc = cipher.encrypt("old message")
        # Force timestamp to the past
        enc.timestamp = time.time() - 9999
        with pytest.raises(TimeoutError):
            cipher.decrypt(enc, max_age_seconds=300)


# ─────────────────────────────────────────────────────────────────────────────
# EncryptedPayload serialisation
# ─────────────────────────────────────────────────────────────────────────────

class TestEncryptedPayloadSerde:
    def test_to_dict_and_back(self, cipher):
        enc  = cipher.encrypt("roundtrip")
        d    = enc.to_dict()
        enc2 = EncryptedPayload.from_dict(d)
        assert enc.nonce_b64      == enc2.nonce_b64
        assert enc.ciphertext_b64 == enc2.ciphertext_b64
        assert enc.key_version    == enc2.key_version

    def test_to_json_and_back(self, cipher):
        enc  = cipher.encrypt("json roundtrip")
        js   = enc.to_json()
        enc2 = EncryptedPayload.from_json(js)
        assert cipher.decrypt(enc2) == "json roundtrip"


# ─────────────────────────────────────────────────────────────────────────────
# Module-level convenience functions
# ─────────────────────────────────────────────────────────────────────────────

class TestConvenienceFunctions:
    def test_encrypt_decrypt_message(self, key32):
        payload   = encrypt_message(key32, "convenience test", key_version=3)
        plaintext = decrypt_message(key32, payload)
        assert plaintext == "convenience test"

    def test_encrypt_returns_dict(self, key32):
        payload = encrypt_message(key32, "test")
        assert isinstance(payload, dict)
        assert "nonce_b64" in payload
        assert "ciphertext_b64" in payload