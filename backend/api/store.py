# backend/api/store.py
"""
In-memory store for rooms, quantum keys, and message history.

Architecture
------------
This module acts as the single source of truth for all runtime state.
In production you would replace this with Redis; for this demo,
a thread-safe in-memory dict is sufficient.

Key concepts:
  - Room      : A named chat channel (e.g. "room-alpha")
  - KeyRecord : The current AES key (derived from BB84) for a room,
                plus metadata (version, QBER, generation time)
  - Message   : Stored as encrypted payload + metadata; never stored
                in plaintext after initial receipt
"""

import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config import KEY_REFRESH_EVERY


# ─────────────────────────────────────────────────────────────────────────────
# Data structures
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class KeyRecord:
    """Stores one BB84-derived AES key and its metadata."""
    key_bytes:      bytes
    key_hex:        str
    key_version:    int
    qber:           float
    qber_safe:      bool
    generated_at:   float = field(default_factory=time.time)
    messages_used:  int   = 0        # how many messages encrypted with this key
    bloch_vectors:  list  = field(default_factory=list)
    noise_enabled:  bool  = True
    sim_time_ms:    float = 0.0

    def needs_refresh(self) -> bool:
        """True when this key has been used KEY_REFRESH_EVERY times."""
        return self.messages_used >= KEY_REFRESH_EVERY

    def to_dict(self) -> dict:
        return {
            "key_version":   self.key_version,
            "key_hex":       self.key_hex,
            "key_preview":   self.key_hex[:16] + "...",
            "qber":          round(self.qber, 4),
            "qber_safe":     self.qber_safe,
            "generated_at":  self.generated_at,
            "messages_used": self.messages_used,
            "noise_enabled": self.noise_enabled,
            "sim_time_ms":   round(self.sim_time_ms, 2),
            "needs_refresh": self.needs_refresh(),
        }


@dataclass
class StoredMessage:
    """One chat message as stored server-side."""
    message_id:      str
    room_id:         str
    sender:          str
    encrypted_payload: dict          # EncryptedPayload.to_dict()
    plaintext_preview: str           # first 20 chars for server logs ONLY
    key_version:     int
    timestamp:       float = field(default_factory=time.time)
    is_llm_reply:    bool  = False

    def to_dict(self) -> dict:
        return {
            "message_id":       self.message_id,
            "room_id":          self.room_id,
            "sender":           self.sender,
            "encrypted_payload": self.encrypted_payload,
            "key_version":      self.key_version,
            "timestamp":        self.timestamp,
            "is_llm_reply":     self.is_llm_reply,
            # Never send plaintext_preview to client — server-side only
        }


@dataclass
class Room:
    """One chat room."""
    room_id:      str
    created_at:   float = field(default_factory=time.time)
    members:      List[str] = field(default_factory=list)
    messages:     List[StoredMessage] = field(default_factory=list)
    key_record:   Optional[KeyRecord] = None
    message_count: int = 0           # total messages ever sent in this room

    def add_member(self, sid: str) -> None:
        if sid not in self.members:
            self.members.append(sid)

    def remove_member(self, sid: str) -> None:
        self.members = [m for m in self.members if m != sid]

    def to_dict(self) -> dict:
        return {
            "room_id":       self.room_id,
            "created_at":    self.created_at,
            "member_count":  len(self.members),
            "message_count": self.message_count,
            "has_key":       self.key_record is not None,
            "key_info":      self.key_record.to_dict() if self.key_record else None,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Thread-safe store
# ─────────────────────────────────────────────────────────────────────────────

class ChatStore:
    """
    Thread-safe in-memory store for all rooms and messages.

    All public methods acquire a reentrant lock — safe for Flask-SocketIO
    with eventlet green threads.
    """

    MAX_MESSAGES_PER_ROOM = 200   # rolling window

    def __init__(self):
        self._lock  = threading.RLock()
        self._rooms: Dict[str, Room] = {}

    # ── Room management ───────────────────────────────────────────────────────

    def get_or_create_room(self, room_id: str) -> Room:
        with self._lock:
            if room_id not in self._rooms:
                self._rooms[room_id] = Room(room_id=room_id)
            return self._rooms[room_id]

    def get_room(self, room_id: str) -> Optional[Room]:
        with self._lock:
            return self._rooms.get(room_id)

    def list_rooms(self) -> List[dict]:
        with self._lock:
            return [r.to_dict() for r in self._rooms.values()]

    def delete_room(self, room_id: str) -> bool:
        with self._lock:
            if room_id in self._rooms:
                del self._rooms[room_id]
                return True
            return False

    # ── Member management ─────────────────────────────────────────────────────

    def join_room(self, room_id: str, sid: str) -> Room:
        with self._lock:
            room = self.get_or_create_room(room_id)
            room.add_member(sid)
            return room

    def leave_room(self, room_id: str, sid: str) -> None:
        with self._lock:
            room = self.get_room(room_id)
            if room:
                room.remove_member(sid)

    def find_rooms_for_sid(self, sid: str) -> List[str]:
        """Return all room_ids that contain this socket session."""
        with self._lock:
            return [
                rid for rid, room in self._rooms.items()
                if sid in room.members
            ]

    # ── Key management ────────────────────────────────────────────────────────

    def set_key(self, room_id: str, key_record: KeyRecord) -> None:
        with self._lock:
            room = self.get_or_create_room(room_id)
            room.key_record = key_record

    def get_key(self, room_id: str) -> Optional[KeyRecord]:
        with self._lock:
            room = self.get_room(room_id)
            return room.key_record if room else None

    def increment_key_usage(self, room_id: str) -> Optional[KeyRecord]:
        """
        Increment message counter for the room's current key.
        Returns the updated KeyRecord (caller checks needs_refresh()).
        """
        with self._lock:
            room = self.get_room(room_id)
            if room and room.key_record:
                room.key_record.messages_used += 1
                return room.key_record
            return None

    # ── Message management ────────────────────────────────────────────────────

    def add_message(
        self,
        room_id:            str,
        message_id:         str,
        sender:             str,
        encrypted_payload:  dict,
        plaintext_preview:  str,
        key_version:        int,
        is_llm_reply:       bool = False,
    ) -> StoredMessage:
        with self._lock:
            room = self.get_or_create_room(room_id)
            msg  = StoredMessage(
                message_id        = message_id,
                room_id           = room_id,
                sender            = sender,
                encrypted_payload = encrypted_payload,
                plaintext_preview = plaintext_preview[:20],
                key_version       = key_version,
                is_llm_reply      = is_llm_reply,
            )
            room.messages.append(msg)
            room.message_count += 1

            # Rolling window — keep only last MAX_MESSAGES_PER_ROOM
            if len(room.messages) > self.MAX_MESSAGES_PER_ROOM:
                room.messages = room.messages[-self.MAX_MESSAGES_PER_ROOM:]

            return msg

    def get_messages(
        self,
        room_id: str,
        limit:   int = 50,
    ) -> List[dict]:
        with self._lock:
            room = self.get_room(room_id)
            if not room:
                return []
            msgs = room.messages[-limit:]
            return [m.to_dict() for m in msgs]

    # ── Stats ─────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        with self._lock:
            total_msgs = sum(r.message_count for r in self._rooms.values())
            return {
                "total_rooms":    len(self._rooms),
                "total_messages": total_msgs,
                "rooms":          [r.to_dict() for r in self._rooms.values()],
            }


# Singleton instance — imported by routes and socket_events
store = ChatStore()