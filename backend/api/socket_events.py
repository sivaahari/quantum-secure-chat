"""
Flask-SocketIO event handlers.

New in this version:
  - room_joined  now includes key_history (all known key versions + hex)
                 so rejoining users can decrypt messages from any era
  - react_message  new event: toggle emoji reaction on a message
  - reaction_updated  broadcast: tells all room members about new reactions
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

ALLOWED_REACTIONS = {"👍", "❤️", "😂", "🔒", "⚡"}


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

        key_history = store.get_key_history(room_id)

        emit("room_joined", {
            "room_id":     room_id,
            "username":    username,
            "room_info":   room.to_dict(),
            "key_info":    key_record.to_dict() if key_record else None,
            "key_history": key_history,
            "history":     store.get_messages(room_id, limit=50),
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

        room = store.get_room(room_id)
        member_count = len(room.members) if room else 0

        emit("room_left", {"room_id": room_id})
        emit("user_left", {
            "room_id":  room_id,
            "username": username,
            "members":  member_count,
        }, to=room_id, include_self=False)

    @socketio.on("disconnect")
    def on_disconnect():
        sid = flask_request.sid
        for room_id in store.find_rooms_for_sid(sid):
            store.leave_room(room_id, sid)
            room = store.get_room(room_id)
            member_count = len(room.members) if room else 0
            socketio.emit("user_left", {
                "room_id":  room_id,
                "username": "unknown",
                "members":  member_count,
            }, to=room_id)

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

    # ── WebRTC signaling ─────────────────────────────────────────────

    @socketio.on("webrtc_offer")
    def on_webrtc_offer(data: dict):
        room_id = data.get("room_id", "default")
        emit("webrtc_offer", data, to=room_id, include_self=False)

    @socketio.on("webrtc_answer")
    def on_webrtc_answer(data: dict):
        room_id = data.get("room_id", "default")
        emit("webrtc_answer", data, to=room_id, include_self=False)

    @socketio.on("webrtc_ice")
    def on_webrtc_ice(data: dict):
        room_id = data.get("room_id", "default")
        emit("webrtc_ice", data, to=room_id, include_self=False)

    @socketio.on("webrtc_ready")
    def on_webrtc_ready(data: dict):
        room_id = data.get("room_id", "default")
        emit("webrtc_peer_ready", data, to=room_id, include_self=False)

    @socketio.on("react_message")
    def on_react(data: dict):
        room_id    = data.get("room_id", "default")
        message_id = data.get("message_id", "")
        username   = data.get("username", "anonymous")
        emoji      = data.get("emoji", "")

        if emoji not in ALLOWED_REACTIONS:
            emit("error", {"message": f"Reaction '{emoji}' not allowed."})
            return

        updated_msg = store.add_reaction(room_id, message_id, username, emoji)
        if updated_msg is None:
            emit("error", {"message": "Message not found."})
            return

        emit("reaction_updated", {
            "room_id":    room_id,
            "message_id": message_id,
            "reactions":  updated_msg["reactions"],
        }, to=room_id)


def _generate_and_store_key(room_id: str, version: int) -> KeyRecord:
    num_qubits = min(BB84_NUM_QUBITS, 128)

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
        socketio.emit("error", {
            "message": f"Key refresh failed: {str(exc)}"
        }, to=room_id)
        return

    key_history = store.get_key_history(room_id)

    socketio.emit("key_refreshed", {
        "room_id":     room_id,
        "key_info":    new_record.to_dict(),
        "key_history": key_history,
        "message": (
            f"🔑 Quantum key refreshed (v{new_version}) — "
            f"QBER: {new_record.qber:.4f}"
        ),
    }, to=room_id)