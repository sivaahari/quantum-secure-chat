# backend/api/store.py
"""
In-memory store for rooms, quantum keys, message history, and reactions.

Changes from v1:
  - Room.key_history  : keeps last 5 KeyRecords so old messages can be decrypted
  - StoredMessage.reactions : {emoji: [username, ...]} for reaction feature
  - ChatStore.get_key_by_version() : look up any historic key
  - ChatStore.add_reaction()       : toggle a reaction on a message
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
    messages_used:  int   = 0
    bloch_vectors:  list  = field(default_factory=list)
    noise_enabled:  bool  = True
    sim_time_ms:    float = 0.0

    def needs_refresh(self) -> bool:
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
    message_id:        str
    room_id:           str
    sender:            str
    encrypted_payload: dict
    plaintext_preview: str
    key_version:       int
    timestamp:         float = field(default_factory=time.time)
    is_llm_reply:      bool  = False
    # reactions: {emoji: [username, ...]}
    reactions:         Dict[str, List[str]] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "message_id":        self.message_id,
            "room_id":           self.room_id,
            "sender":            self.sender,
            "encrypted_payload": self.encrypted_payload,
            "key_version":       self.key_version,
            "timestamp":         self.timestamp,
            "is_llm_reply":      self.is_llm_reply,
            "reactions":         self.reactions,
        }


@dataclass
class Room:
    """One chat room."""
    room_id:       str
    created_at:    float = field(default_factory=time.time)
    members:       List[str] = field(default_factory=list)
    messages:      List[StoredMessage] = field(default_factory=list)
    key_record:    Optional[KeyRecord] = None
    key_history:   List[KeyRecord] = field(default_factory=list)  # last 5 keys
    message_count: int = 0

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
    """Thread-safe in-memory store for all rooms and messages."""

    MAX_MESSAGES_PER_ROOM = 200
    MAX_KEY_HISTORY       = 5   # keep last 5 keys so old messages can decrypt

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
        with self._lock:
            return [
                rid for rid, room in self._rooms.items()
                if sid in room.members
            ]

    # ── Key management ────────────────────────────────────────────────────────

    def set_key(self, room_id: str, key_record: KeyRecord) -> None:
        """
        Set the current key for a room.
        The OLD key is moved to key_history (capped at MAX_KEY_HISTORY)
        so messages encrypted with it can still be decrypted.
        """
        with self._lock:
            room = self.get_or_create_room(room_id)
            if room.key_record is not None:
                # Save old key to history before replacing
                room.key_history.append(room.key_record)
                # Rolling window — keep only the most recent N keys
                if len(room.key_history) > self.MAX_KEY_HISTORY:
                    room.key_history = room.key_history[-self.MAX_KEY_HISTORY:]
            room.key_record = key_record

    def get_key(self, room_id: str) -> Optional[KeyRecord]:
        with self._lock:
            room = self.get_room(room_id)
            return room.key_record if room else None

    def get_key_by_version(self, room_id: str, version: int) -> Optional[KeyRecord]:
        """
        Look up a specific key version — current or historical.
        Used when a rejoining user needs to decrypt old messages.
        """
        with self._lock:
            room = self.get_room(room_id)
            if not room:
                return None
            # Check current key first
            if room.key_record and room.key_record.key_version == version:
                return room.key_record
            # Check history
            for kr in room.key_history:
                if kr.key_version == version:
                    return kr
            return None

    def get_key_history(self, room_id: str) -> List[dict]:
        """
        Return all key versions (current + history) as dicts for the
        room_joined event payload. Includes key_hex so client can decrypt
        messages from any era.
        """
        with self._lock:
            room = self.get_room(room_id)
            if not room:
                return []
            result = [kr.to_dict() for kr in room.key_history]
            if room.key_record:
                result.append(room.key_record.to_dict())
            return result

    def increment_key_usage(self, room_id: str) -> Optional[KeyRecord]:
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
            if len(room.messages) > self.MAX_MESSAGES_PER_ROOM:
                room.messages = room.messages[-self.MAX_MESSAGES_PER_ROOM:]
            return msg

    def get_messages(self, room_id: str, limit: int = 50) -> List[dict]:
        with self._lock:
            room = self.get_room(room_id)
            if not room:
                return []
            return [m.to_dict() for m in room.messages[-limit:]]

    # ── Reactions ─────────────────────────────────────────────────────────────

    def add_reaction(
        self,
        room_id:    str,
        message_id: str,
        username:   str,
        emoji:      str,
    ) -> Optional[dict]:
        """
        Toggle a reaction on a message.
        - If the user hasn't reacted with this emoji: add them
        - If they have: remove (toggle off)
        Returns the updated StoredMessage dict or None if not found.
        """
        with self._lock:
            room = self.get_room(room_id)
            if not room:
                return None
            for msg in room.messages:
                if msg.message_id == message_id:
                    if emoji not in msg.reactions:
                        msg.reactions[emoji] = []
                    if username in msg.reactions[emoji]:
                        msg.reactions[emoji].remove(username)
                        if not msg.reactions[emoji]:
                            del msg.reactions[emoji]
                    else:
                        msg.reactions[emoji].append(username)
                    return msg.to_dict()
            return None

    # ── Stats ─────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        with self._lock:
            total_msgs = sum(r.message_count for r in self._rooms.values())
            return {
                "total_rooms":    len(self._rooms),
                "total_messages": total_msgs,
                "rooms":          [r.to_dict() for r in self._rooms.values()],
            }


# Singleton
store = ChatStore()