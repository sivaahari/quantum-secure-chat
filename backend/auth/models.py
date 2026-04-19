# backend/auth/models.py
"""
User, JoinRequest, and RoomMembership data models.
All stored in-memory (thread-safe). Replace with Redis/DB for production.

First registered user automatically becomes admin.
Regular users start as "pending" until admin approves.
"""

import time
import uuid
import threading
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import bcrypt


# ─────────────────────────────────────────────────────────────────────────────
# Data classes
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class User:
    user_id:       str
    username:      str
    password_hash: str
    role:          str             # "admin" | "user"
    status:        str             # "pending" | "approved" | "rejected"
    created_at:    float = field(default_factory=time.time)
    approved_by:   Optional[str]   = None
    approved_at:   Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "user_id":     self.user_id,
            "username":    self.username,
            "role":        self.role,
            "status":      self.status,
            "created_at":  self.created_at,
            "approved_by": self.approved_by,
            "approved_at": self.approved_at,
        }

    def check_password(self, password: str) -> bool:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            self.password_hash.encode("utf-8"),
        )


@dataclass
class JoinRequest:
    request_id:  str
    user_id:     str
    username:    str
    room_id:     str
    status:      str             # "pending" | "approved" | "rejected"
    message:     str = ""
    created_at:  float = field(default_factory=time.time)
    decided_by:  Optional[str]   = None
    decided_at:  Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "request_id":  self.request_id,
            "user_id":     self.user_id,
            "username":    self.username,
            "room_id":     self.room_id,
            "status":      self.status,
            "message":     self.message,
            "created_at":  self.created_at,
            "decided_by":  self.decided_by,
            "decided_at":  self.decided_at,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Thread-safe store
# ─────────────────────────────────────────────────────────────────────────────

class UserStore:
    """
    Central in-memory store for users, join requests, and room memberships.
    All methods are thread-safe via RLock.
    """

    def __init__(self):
        self._lock         = threading.RLock()
        self._users:       Dict[str, User]       = {}   # user_id → User
        self._by_username: Dict[str, str]        = {}   # username → user_id
        self._requests:    Dict[str, JoinRequest]= {}   # request_id → JoinRequest
        # room_id → set of user_ids
        self._memberships: Dict[str, set]        = {}

    # ── User management ───────────────────────────────────────────────────────

    def has_any_admin(self) -> bool:
        with self._lock:
            return any(u.role == "admin" for u in self._users.values())

    def create_user(self, username: str, password: str) -> User:
        with self._lock:
            if username in self._by_username:
                raise ValueError(f"Username '{username}' is already taken")

            # First registered user becomes admin (auto-approved)
            role   = "admin" if not self.has_any_admin() else "user"
            status = "approved" if role == "admin" else "pending"

            pw_hash = bcrypt.hashpw(
                password.encode("utf-8"), bcrypt.gensalt()
            ).decode("utf-8")

            user = User(
                user_id       = str(uuid.uuid4()),
                username      = username,
                password_hash = pw_hash,
                role          = role,
                status        = status,
            )
            self._users[user.user_id]   = user
            self._by_username[username] = user.user_id
            return user

    def get_by_id(self, user_id: str) -> Optional[User]:
        with self._lock:
            return self._users.get(user_id)

    def get_by_username(self, username: str) -> Optional[User]:
        with self._lock:
            uid = self._by_username.get(username)
            return self._users.get(uid) if uid else None

    def list_all_users(self) -> List[User]:
        with self._lock:
            return list(self._users.values())

    def list_pending_users(self) -> List[User]:
        with self._lock:
            return [u for u in self._users.values() if u.status == "pending"]

    def approve_user(self, user_id: str, admin_id: str) -> Optional[User]:
        with self._lock:
            u = self._users.get(user_id)
            if u:
                u.status      = "approved"
                u.approved_by = admin_id
                u.approved_at = time.time()
            return u

    def reject_user(self, user_id: str, admin_id: str) -> Optional[User]:
        with self._lock:
            u = self._users.get(user_id)
            if u:
                u.status      = "rejected"
                u.approved_by = admin_id
                u.approved_at = time.time()
            return u

    # ── Room membership ────────────────────────────────────────────────────────

    def create_room(self, room_id: str, admin_id: str):
        """Admin creates a room; admin automatically gets membership."""
        with self._lock:
            if room_id not in self._memberships:
                self._memberships[room_id] = set()
            self._memberships[room_id].add(admin_id)

    def has_membership(self, room_id: str, user_id: str) -> bool:
        with self._lock:
            return user_id in self._memberships.get(room_id, set())

    def grant_membership(self, room_id: str, user_id: str):
        with self._lock:
            if room_id not in self._memberships:
                self._memberships[room_id] = set()
            self._memberships[room_id].add(user_id)

    def get_user_rooms(self, user_id: str) -> List[str]:
        with self._lock:
            return [
                rid for rid, members in self._memberships.items()
                if user_id in members
            ]

    def list_all_rooms(self) -> List[dict]:
        with self._lock:
            return [
                {"room_id": rid, "member_count": len(m)}
                for rid, m in self._memberships.items()
            ]

    # ── Join requests ─────────────────────────────────────────────────────────

    def create_join_request(
        self,
        user_id:  str,
        username: str,
        room_id:  str,
        message:  str = "",
    ) -> JoinRequest:
        with self._lock:
            # Block if already has membership
            if self.has_membership(room_id, user_id):
                raise ValueError("You already have access to this room")
            # Block duplicate pending requests
            for req in self._requests.values():
                if (req.user_id == user_id and
                        req.room_id == room_id and
                        req.status == "pending"):
                    raise ValueError(
                        "You already have a pending request for this room"
                    )
            req = JoinRequest(
                request_id = str(uuid.uuid4()),
                user_id    = user_id,
                username   = username,
                room_id    = room_id,
                message    = message,
                status     = "pending",
            )
            self._requests[req.request_id] = req
            return req

    def get_join_request(self, request_id: str) -> Optional[JoinRequest]:
        with self._lock:
            return self._requests.get(request_id)

    def list_pending_requests(self) -> List[JoinRequest]:
        with self._lock:
            return [r for r in self._requests.values() if r.status == "pending"]

    def list_requests_for_user(self, user_id: str) -> List[JoinRequest]:
        with self._lock:
            return [r for r in self._requests.values() if r.user_id == user_id]

    def approve_request(self, request_id: str, admin_id: str) -> Optional[JoinRequest]:
        with self._lock:
            req = self._requests.get(request_id)
            if req:
                req.status     = "approved"
                req.decided_by = admin_id
                req.decided_at = time.time()
                self.grant_membership(req.room_id, req.user_id)
            return req

    def reject_request(self, request_id: str, admin_id: str) -> Optional[JoinRequest]:
        with self._lock:
            req = self._requests.get(request_id)
            if req:
                req.status     = "rejected"
                req.decided_by = admin_id
                req.decided_at = time.time()
            return req

    def get_stats(self) -> dict:
        with self._lock:
            return {
                "total_users":    len(self._users),
                "pending_users":  len([u for u in self._users.values() if u.status == "pending"]),
                "approved_users": len([u for u in self._users.values() if u.status == "approved"]),
                "total_rooms":    len(self._memberships),
                "pending_requests": len([r for r in self._requests.values() if r.status == "pending"]),
            }


# Singleton
user_store = UserStore()