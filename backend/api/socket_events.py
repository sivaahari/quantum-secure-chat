# backend/api/socket_events.py
"""
Flask-SocketIO event handlers — LLM removed, pure quantum-encrypted chat.
"""

import uuid
import os
import sys

from flask import request as flask_request
from flask_socketio import SocketIO, join_room as sio_join, leave_room as sio_leave, emit

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config import BB84_NUM_QUBITS, BB84_NOISE_ENABLED, BB84_DEPOLAR_PROB
from quantum import run_bb84
from .store  import store, KeyRecord


def register_socket_events(socketio: SocketIO) -> None:

    @socketio.on("join_room")
    def on_join(data: dict):
        room_id  = data.get("room_id", "default")
        username = data.get("username", "anonymous")
        sid      = flask_request.sid

        room = store.join_room(room_id, sid)
        sio_join(room_id)

        key_record = store.get_key(room_id)
        if key_record is None:
            key_record = _generate_and_store_key(room_id, version=1)

        emit("room_joined", {
            "room_id":   room_id,
            "username":  username,
            "room_info": room.to_dict(),
            "key_info":  key_record.to_dict() if key_record else None,
            "history":   store.get_messages(room_id, limit=30),
        })

        emit("user_joined", {
            "room_id":  room_id,
            "username": username,
            "members":  len(room.members),
        }, to=room_id, include_self=False)

    @socketio.on("leave_room")
    def on_leave(data: dict):
        room_id  = data.get("room_id", "default")
        username = data.get("username", "anonymous")
        sid      = flask_request.sid

        store.leave_room(room_id, sid)
        sio_leave(room_id)

        emit("room_left", {"room_id": room_id})
        emit("user_left", {
            "room_id":  room_id,
            "username": username,
        }, to=room_id, include_self=False)

    @socketio.on("disconnect")
    def on_disconnect():
        sid = flask_request.sid
        for room_id in store.find_rooms_for_sid(sid):
            store.leave_room(room_id, sid)

    @socketio.on("send_message")
    def on_message(data: dict):
        room_id           = data.get("room_id", "default")
        username          = data.get("username", "anonymous")
        encrypted_payload = data.get("encrypted_payload", {})
        plaintext         = data.get("plaintext", "")

        key_record = store.get_key(room_id)
        if not key_record:
            emit("error", {"message": "No key for this room. Generate a quantum key first."})
            return

        msg_id = str(uuid.uuid4())
        stored = store.add_message(
            room_id           = room_id,
            message_id        = msg_id,
            sender            = username,
            encrypted_payload = encrypted_payload,
            plaintext_preview = plaintext[:20],
            key_version       = key_record.key_version,
            is_llm_reply      = False,
        )

        updated_key   = store.increment_key_usage(room_id)
        needs_refresh = updated_key.needs_refresh() if updated_key else False

        emit("new_message", {
            **stored.to_dict(),
            "key_refresh_needed": needs_refresh,
        }, to=room_id)

        if needs_refresh and updated_key:
            _do_key_refresh(room_id, socketio)

    @socketio.on("typing")
    def on_typing(data: dict):
        room_id  = data.get("room_id", "default")
        username = data.get("username", "anonymous")
        emit("typing_indicator", {
            "room_id":  room_id,
            "username": username,
        }, to=room_id, include_self=False)


def _generate_and_store_key(room_id: str, version: int) -> KeyRecord:
    """Use fewer qubits on Railway for faster join response."""
    num_qubits = min(BB84_NUM_QUBITS, 128)   # cap at 128 for prod speed

    result = run_bb84(
        num_qubits    = num_qubits,
        noise_enabled = BB84_NOISE_ENABLED,
        depolar_prob  = BB84_DEPOLAR_PROB,
    )
    key_record = KeyRecord(
        key_bytes     = result.final_key_bytes if result.final_key_bytes else os.urandom(32),
        key_hex       = result.final_key_hex,
        key_version   = version,
        qber          = result.qber,
        qber_safe     = result.qber_safe,
        bloch_vectors = result.bloch_vectors,
        noise_enabled = BB84_NOISE_ENABLED,
        sim_time_ms   = result.simulation_time_ms,
    )
    store.set_key(room_id, key_record)
    return key_record


def _do_key_refresh(room_id: str, socketio: SocketIO) -> None:
    existing    = store.get_key(room_id)
    new_version = (existing.key_version + 1) if existing else 1

    try:
        new_record = _generate_and_store_key(room_id, new_version)
    except Exception as exc:
        socketio.emit("error", {"message": f"Key refresh failed: {str(exc)}"}, to=room_id)
        return

    socketio.emit("key_refreshed", {
        "room_id":  room_id,
        "key_info": new_record.to_dict(),
        "message":  f"🔑 Quantum key refreshed (v{new_version}) — QBER: {new_record.qber:.4f}",
    }, to=room_id)