# backend/api/routes.py
"""
Flask REST API Blueprint.

Endpoints
---------
GET  /api/health              → server + Ollama health check
GET  /api/rooms               → list all active rooms
POST /api/rooms               → create a room
DELETE /api/rooms/<room_id>   → delete a room
POST /api/quantum/generate-key → run BB84, store key for a room, return stats
GET  /api/quantum/key-info/<room_id> → current key metadata for a room
GET  /api/messages/<room_id>  → last N messages (encrypted payloads) for a room
POST /api/crypto/encrypt-demo → encrypt a test string (for E2E demo tab)
POST /api/crypto/decrypt-demo → decrypt a test payload (for E2E demo tab)
GET  /api/stats               → global server stats
"""

import uuid
import sys
import os

from flask import Blueprint, request, jsonify

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config import (
    BB84_NUM_QUBITS,
    BB84_NOISE_ENABLED,
    BB84_DEPOLAR_PROB,
    BB84_EAVESDROP_PROB,
)
from quantum  import run_bb84
from crypto   import AESCipher, encrypt_message, decrypt_message
from .store   import store, KeyRecord

api_bp = Blueprint("api", __name__, url_prefix="/api")


# ─────────────────────────────────────────────────────────────────────────────
# Helper: consistent JSON error responses
# ─────────────────────────────────────────────────────────────────────────────

def err(message: str, code: int = 400) -> tuple:
    return jsonify({"ok": False, "error": message}), code

def ok(data: dict = None, **kwargs) -> tuple:
    payload = {"ok": True}
    if data:
        payload.update(data)
    payload.update(kwargs)
    return jsonify(payload), 200


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────

@api_bp.route("/health", methods=["GET"])
def health():
    return ok(
        flask_status = "running",
        version      = "2.0.0",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Room management
# ─────────────────────────────────────────────────────────────────────────────

@api_bp.route("/rooms", methods=["GET"])
def list_rooms():
    return ok(rooms=store.list_rooms())


@api_bp.route("/rooms", methods=["POST"])
def create_room():
    body    = request.get_json(silent=True) or {}
    room_id = body.get("room_id", "").strip()

    if not room_id:
        room_id = f"room-{uuid.uuid4().hex[:8]}"

    # Sanitise: only alphanumeric and hyphens
    room_id = "".join(c for c in room_id if c.isalnum() or c == "-")
    if not room_id:
        return err("Invalid room_id — use alphanumeric and hyphens only.")

    room = store.get_or_create_room(room_id)
    return ok(room=room.to_dict())


@api_bp.route("/rooms/<room_id>", methods=["DELETE"])
def delete_room(room_id: str):
    deleted = store.delete_room(room_id)
    if not deleted:
        return err(f"Room '{room_id}' not found.", code=404)
    return ok(deleted=True, room_id=room_id)


# ─────────────────────────────────────────────────────────────────────────────
# Quantum key generation
# ─────────────────────────────────────────────────────────────────────────────

@api_bp.route("/quantum/generate-key", methods=["POST"])
def generate_key():
    """
    Run a full BB84 simulation and store the derived AES-256 key for a room.

    Body (JSON, all optional):
    {
        "room_id":        "room-alpha",
        "num_qubits":     256,
        "noise_enabled":  true,
        "depolar_prob":   0.02,
        "eavesdrop_prob": 0.0
    }

    Returns BB84 statistics + Bloch sphere data (NOT the raw key bytes).
    """
    body = request.get_json(silent=True) or {}

    room_id       = body.get("room_id", "default")
    num_qubits    = int(body.get("num_qubits",    BB84_NUM_QUBITS))
    noise_enabled = bool(body.get("noise_enabled", BB84_NOISE_ENABLED))
    depolar_prob  = float(body.get("depolar_prob",  BB84_DEPOLAR_PROB))
    eavesdrop_prob= float(body.get("eavesdrop_prob",BB84_EAVESDROP_PROB))

    # Clamp qubits to sensible range (too many = slow, too few = insecure)
    num_qubits = max(64, min(num_qubits, 1024))

    try:
        result = run_bb84(
            num_qubits     = num_qubits,
            noise_enabled  = noise_enabled,
            depolar_prob   = depolar_prob,
            eavesdrop_prob = eavesdrop_prob,
        )
    except Exception as exc:
        return err(f"BB84 simulation failed: {str(exc)}", code=500)

    if not result.qber_safe:
        return jsonify({
            "ok":      False,
            "error":   (
                f"QBER {result.qber:.4f} exceeds safety threshold 0.11 — "
                "possible eavesdropper or channel too noisy. "
                "Key exchange aborted."
            ),
            "qber":    result.qber,
            "bb84":    result.to_dict(),
        }), 422

    if not result.final_key_bytes:
        return err("BB84 produced no key material — try more qubits.", code=500)

    # Determine new key version
    existing = store.get_key(room_id)
    new_version = (existing.key_version + 1) if existing else 1

    key_record = KeyRecord(
        key_bytes    = result.final_key_bytes,
        key_hex      = result.final_key_hex,
        key_version  = new_version,
        qber         = result.qber,
        qber_safe    = result.qber_safe,
        bloch_vectors= result.bloch_vectors,
        noise_enabled= noise_enabled,
        sim_time_ms  = result.simulation_time_ms,
    )
    store.set_key(room_id, key_record)

    return ok(
        room_id     = room_id,
        key_version = new_version,
        bb84        = result.to_dict(),
        key_info    = key_record.to_dict(),
    )


@api_bp.route("/quantum/key-info/<room_id>", methods=["GET"])
def key_info(room_id: str):
    """Return current key metadata (never the raw key bytes)."""
    record = store.get_key(room_id)
    if not record:
        return err(f"No key found for room '{room_id}'. Generate one first.", code=404)
    return ok(room_id=room_id, key_info=record.to_dict())


# ─────────────────────────────────────────────────────────────────────────────
# Message history
# ─────────────────────────────────────────────────────────────────────────────

@api_bp.route("/messages/<room_id>", methods=["GET"])
def get_messages(room_id: str):
    """
    Return the last N encrypted messages for a room.
    Clients decrypt them locally using their copy of the AES key.
    """
    limit = min(int(request.args.get("limit", 50)), 200)
    msgs  = store.get_messages(room_id, limit=limit)
    return ok(room_id=room_id, messages=msgs, count=len(msgs))


# ─────────────────────────────────────────────────────────────────────────────
# E2E Demo endpoints (for the "Encryption Demo" tab in the UI)
# ─────────────────────────────────────────────────────────────────────────────

@api_bp.route("/crypto/encrypt-demo", methods=["POST"])
def encrypt_demo():
    """
    Encrypt a plaintext string using the current room key.
    Body: { "room_id": "...", "plaintext": "Hello World" }
    """
    body      = request.get_json(silent=True) or {}
    room_id   = body.get("room_id", "default")
    plaintext = body.get("plaintext", "")

    if not plaintext:
        return err("plaintext is required.")

    record = store.get_key(room_id)
    if not record:
        return err(f"No key for room '{room_id}'. Run BB84 first.", code=404)

    try:
        payload = encrypt_message(
            record.key_bytes,
            plaintext,
            key_version=record.key_version,
        )
        return ok(
            room_id     = room_id,
            plaintext   = plaintext,
            encrypted   = payload,
            key_version = record.key_version,
        )
    except Exception as exc:
        return err(f"Encryption failed: {str(exc)}", code=500)


@api_bp.route("/crypto/decrypt-demo", methods=["POST"])
def decrypt_demo():
    """
    Decrypt an EncryptedPayload dict using the current room key.
    Body: { "room_id": "...", "payload": { ...EncryptedPayload... } }
    """
    body    = request.get_json(silent=True) or {}
    room_id = body.get("room_id", "default")
    payload = body.get("payload")

    if not payload:
        return err("payload is required.")

    record = store.get_key(room_id)
    if not record:
        return err(f"No key for room '{room_id}'. Run BB84 first.", code=404)

    try:
        plaintext = decrypt_message(record.key_bytes, payload)
        return ok(
            room_id   = room_id,
            plaintext = plaintext,
        )
    except TimeoutError as exc:
        return err(str(exc), code=408)
    except Exception as exc:
        return err(f"Decryption/authentication failed: {str(exc)}", code=422)


# ─────────────────────────────────────────────────────────────────────────────
# Stats
# ─────────────────────────────────────────────────────────────────────────────

@api_bp.route("/stats", methods=["GET"])
def stats():
    return ok(**store.get_stats())
