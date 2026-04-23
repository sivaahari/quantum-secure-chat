# backend/api/socket_events.py
"""
Flask-SocketIO event handlers with JWT authentication.

Socket connection now requires a valid JWT passed as auth.token.
join_room checks that the user has membership in the requested room
(admins bypass this check and can enter any room).
"""

import uuid
import os
import sys

from flask import request as flask_request
from flask_socketio import SocketIO, join_room as sio_join, leave_room as sio_leave, emit

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config          import BB84_NUM_QUBITS, BB84_NOISE_ENABLED, BB84_DEPOLAR_PROB
from quantum         import run_bb84
from auth.jwt_utils  import verify_token
from auth.models     import user_store
from .store          import store, KeyRecord

ALLOWED_REACTIONS = {"👍", "❤️", "😂", "🔒", "⚡"}

# Maps socket session ID → JWT payload (set on connect, cleared on disconnect)
_authenticated: dict = {}


def register_socket_events(socketio: SocketIO) -> None:

    # ── connect (JWT verification) ────────────────────────────────────────────

    @socketio.on("connect")
    def on_connect(auth):
        """
        Verify JWT on every socket connection.
        Client must pass: io(URL, { auth: { token: "<jwt>" } })
        """
        token = (auth or {}).get("token")
        if not token:
            raise ConnectionRefusedError("Authentication required")

        payload = verify_token(token)
        if not payload:
            raise ConnectionRefusedError("Invalid or expired token")

        user = user_store.get_by_id(payload["user_id"])
        if not user or user.status != "approved":
            raise ConnectionRefusedError("Account not approved")

        _authenticated[flask_request.sid] = payload
        print(f"[Socket] ✅ {payload['username']} ({payload['role']}) connected")

    # ── disconnect ────────────────────────────────────────────────────────────

    @socketio.on("disconnect")
    def on_disconnect():
        sid = flask_request.sid
        _authenticated.pop(sid, None)
        for room_id in store.find_rooms_for_sid(sid):
            store.leave_room(room_id, sid)
            room = store.get_room(room_id)
            socketio.emit("user_left", {
                "room_id":  room_id,
                "username": "unknown",
                "members":  len(room.members) if room else 0,
            }, to=room_id)

    # ── join_room ─────────────────────────────────────────────────────────────

    @socketio.on("join_room")
    def on_join(data: dict):
        sid     = flask_request.sid
        auth    = _authenticated.get(sid)
        if not auth:
            emit("error", {"message": "Not authenticated"})
            return

        room_id  = data.get("room_id", "default")
        username = auth["username"]
        user_id  = auth["user_id"]
        role     = auth["role"]

        # Access control: admin can join any room; users need membership
        if role != "admin" and not user_store.has_membership(room_id, user_id):
            emit("error", {
                "message": (
                    f"You don't have access to room '{room_id}'. "
                    "Request access from the admin first."
                )
            })
            return

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

    # ── leave_room ────────────────────────────────────────────────────────────

    @socketio.on("leave_room")
    def on_leave(data: dict):
        sid  = flask_request.sid
        auth = _authenticated.get(sid)
        if not auth:
            return

        room_id  = data.get("room_id", "default")
        username = auth["username"]

        store.leave_room(room_id, sid)
        sio_leave(room_id)

        room = store.get_room(room_id)
        emit("room_left", {"room_id": room_id})
        emit("user_left", {
            "room_id":  room_id,
            "username": username,
            "members":  len(room.members) if room else 0,
        }, to=room_id, include_self=False)

    # ── send_message ──────────────────────────────────────────────────────────

    @socketio.on("send_message")
    def on_message(data: dict):
        sid  = flask_request.sid
        auth = _authenticated.get(sid)
        if not auth:
            emit("error", {"message": "Not authenticated"})
            return

        room_id           = data.get("room_id", "default")
        encrypted_payload = data.get("encrypted_payload", {})
        plaintext         = data.get("plaintext", "")
        username          = auth["username"]

        key_record = store.get_key(room_id)
        if not key_record:
            emit("error", {"message": "No key for this room. Generate a quantum key first."})
            return

        # Use key version from payload (fixes post-refresh P2P sync bug)
        payload_key_version = int(
            encrypted_payload.get("key_version", key_record.key_version)
        )

        msg_id = str(uuid.uuid4())
        stored = store.add_message(
            room_id           = room_id,
            message_id        = msg_id,
            sender            = username,
            encrypted_payload = encrypted_payload,
            plaintext_preview = plaintext[:20],
            key_version       = payload_key_version,
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

    # ── typing ────────────────────────────────────────────────────────────────

    @socketio.on("typing")
    def on_typing(data: dict):
        sid  = flask_request.sid
        auth = _authenticated.get(sid)
        if not auth:
            return
        emit("typing_indicator", {
            "room_id":  data.get("room_id", "default"),
            "username": auth["username"],
        }, to=data.get("room_id", "default"), include_self=False)

    # ── react_message ─────────────────────────────────────────────────────────

    @socketio.on("react_message")
    def on_react(data: dict):
        sid  = flask_request.sid
        auth = _authenticated.get(sid)
        if not auth:
            return

        room_id    = data.get("room_id", "default")
        message_id = data.get("message_id", "")
        emoji      = data.get("emoji", "")

        if emoji not in ALLOWED_REACTIONS:
            emit("error", {"message": f"Reaction '{emoji}' not allowed."})
            return

        updated = store.add_reaction(room_id, message_id, auth["username"], emoji)
        if not updated:
            emit("error", {"message": "Message not found."})
            return

        emit("reaction_updated", {
            "room_id":    room_id,
            "message_id": message_id,
            "reactions":  updated["reactions"],
        }, to=room_id)

    # ── delete_message ───────────────────────────────────────────────────────

    @socketio.on("delete_message")
    def on_delete_message(data: dict):
        sid  = flask_request.sid
        auth = _authenticated.get(sid)
        if not auth:
            return

        room_id    = data.get("room_id", "")
        message_id = data.get("message_id", "")

        updated = store.delete_message(
            room_id, message_id, auth["username"], auth["role"] == "admin"
        )
        if updated:
            emit("message_deleted", {
                "room_id":    room_id,
                "message_id": message_id,
            }, to=room_id)
        else:
            emit("error", {"message": "Cannot delete that message."})

    # ── edit_message ──────────────────────────────────────────────────────────

    @socketio.on("edit_message")
    def on_edit_message(data: dict):
        sid  = flask_request.sid
        auth = _authenticated.get(sid)
        if not auth:
            return

        room_id           = data.get("room_id", "")
        message_id        = data.get("message_id", "")
        encrypted_payload = data.get("encrypted_payload", {})

        updated = store.edit_message(
            room_id, message_id, encrypted_payload, auth["username"]
        )
        if updated:
            emit("message_edited", {
                "room_id":           room_id,
                "message_id":        message_id,
                "encrypted_payload": updated["encrypted_payload"],
                "edited_at":         updated["edited_at"],
            }, to=room_id)
        else:
            emit("error", {"message": "Cannot edit that message."})

    # ── mark_read ─────────────────────────────────────────────────────────────

    @socketio.on("mark_read")
    def on_mark_read(data: dict):
        sid  = flask_request.sid
        auth = _authenticated.get(sid)
        if not auth:
            return

        room_id    = data.get("room_id", "")
        message_id = data.get("message_id", "")
        username   = auth["username"]

        updated = store.mark_read(room_id, message_id, username)
        if updated:
            emit("message_read", {
                "room_id":    room_id,
                "message_id": message_id,
                "read_by":    updated["read_by"],
            }, to=room_id)

    # ── WebRTC signaling ──────────────────────────────────────────────────────

    @socketio.on("webrtc_offer")
    def on_webrtc_offer(data):
        emit("webrtc_offer",      data, to=data.get("room_id"), include_self=False)

    @socketio.on("webrtc_answer")
    def on_webrtc_answer(data):
        emit("webrtc_answer",     data, to=data.get("room_id"), include_self=False)

    @socketio.on("webrtc_ice")
    def on_webrtc_ice(data):
        emit("webrtc_ice",        data, to=data.get("room_id"), include_self=False)

    @socketio.on("webrtc_ready")
    def on_webrtc_ready(data):
        emit("webrtc_peer_ready", data, to=data.get("room_id"), include_self=False)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _generate_and_store_key(room_id: str, version: int) -> KeyRecord:
    result = run_bb84(
        num_qubits    = min(BB84_NUM_QUBITS, 128),
        noise_enabled = BB84_NOISE_ENABLED,
        depolar_prob  = BB84_DEPOLAR_PROB,
    )
    key_record = KeyRecord(
        key_bytes     = result.final_key_bytes or os.urandom(32),
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
        socketio.emit("error", {"message": f"Key refresh failed: {exc}"}, to=room_id)
        return

    socketio.emit("key_refreshed", {
        "room_id":     room_id,
        "key_info":    new_record.to_dict(),
        "key_history": store.get_key_history(room_id),
        "message":     f"🔑 Key refreshed (v{new_version}) — QBER: {new_record.qber:.4f}",
    }, to=room_id)