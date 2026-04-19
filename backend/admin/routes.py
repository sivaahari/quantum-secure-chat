# backend/admin/routes.py
"""
Admin and user-facing management endpoints.

Admin endpoints (require admin JWT):
  GET  /admin/users                         → list all users
  GET  /admin/users/pending                 → list pending users
  POST /admin/users/<id>/approve            → approve user
  POST /admin/users/<id>/reject             → reject user
  GET  /admin/rooms                         → list all rooms
  POST /admin/rooms                         → create room
  POST /admin/rooms/<room_id>/grant/<uid>   → directly grant room access
  GET  /admin/join-requests                 → list join requests
  POST /admin/join-requests/<id>/approve    → approve join request
  POST /admin/join-requests/<id>/reject     → reject join request
  GET  /admin/stats                         → dashboard stats

User endpoints (require any valid JWT):
  POST /admin/request-access                → request to join a room
  GET  /admin/my-rooms                      → rooms user has access to
  GET  /admin/my-requests                   → user's join requests
"""

import uuid
from functools import wraps
from flask import Blueprint, request, jsonify
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from auth.models    import user_store
from auth.jwt_utils import verify_token, token_from_request
from api.store      import store

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


# ─────────────────────────────────────────────────────────────────────────────
# Auth decorators
# ─────────────────────────────────────────────────────────────────────────────

def ok(**kwargs):
    return jsonify({"ok": True, **kwargs}), 200

def err(msg, code=400):
    return jsonify({"ok": False, "error": msg}), code


def require_admin(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        token = token_from_request(request)
        if not token:
            return err("Authentication required", code=401)
        payload = verify_token(token)
        if not payload:
            return err("Invalid or expired token", code=401)
        if payload.get("role") != "admin":
            return err("Admin access required", code=403)
        request.auth = payload
        return f(*args, **kwargs)
    return wrapped


def require_auth(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        token = token_from_request(request)
        if not token:
            return err("Authentication required", code=401)
        payload = verify_token(token)
        if not payload:
            return err("Invalid or expired token", code=401)
        request.auth = payload
        return f(*args, **kwargs)
    return wrapped


# ─────────────────────────────────────────────────────────────────────────────
# Admin — user management
# ─────────────────────────────────────────────────────────────────────────────

@admin_bp.route("/users", methods=["GET"])
@require_admin
def list_users():
    users = user_store.list_all_users()
    return ok(users=[u.to_dict() for u in users])


@admin_bp.route("/users/pending", methods=["GET"])
@require_admin
def pending_users():
    users = user_store.list_pending_users()
    return ok(users=[u.to_dict() for u in users])


@admin_bp.route("/users/<user_id>/approve", methods=["POST"])
@require_admin
def approve_user(user_id):
    user = user_store.approve_user(user_id, request.auth["user_id"])
    if not user:
        return err("User not found", code=404)
    return ok(user=user.to_dict(), message=f"✅ '{user.username}' approved")


@admin_bp.route("/users/<user_id>/reject", methods=["POST"])
@require_admin
def reject_user(user_id):
    user = user_store.reject_user(user_id, request.auth["user_id"])
    if not user:
        return err("User not found", code=404)
    return ok(user=user.to_dict(), message=f"❌ '{user.username}' rejected")


# ─────────────────────────────────────────────────────────────────────────────
# Admin — room management
# ─────────────────────────────────────────────────────────────────────────────

@admin_bp.route("/rooms", methods=["GET"])
@require_admin
def list_rooms():
    rooms = user_store.list_all_rooms()
    for room in rooms:
        chat_room = store.get_room(room["room_id"])
        if chat_room:
            room["message_count"] = chat_room.message_count
            room["has_key"]       = chat_room.key_record is not None
        else:
            room["message_count"] = 0
            room["has_key"]       = False
    return ok(rooms=rooms)


@admin_bp.route("/rooms", methods=["POST"])
@require_admin
def create_room():
    body    = request.get_json(silent=True) or {}
    room_id = body.get("room_id", "").strip()

    if not room_id:
        room_id = f"room-{uuid.uuid4().hex[:8]}"

    room_id = "".join(c for c in room_id if c.isalnum() or c == "-")
    if not room_id:
        return err("Invalid room ID")

    admin_id = request.auth["user_id"]
    user_store.create_room(room_id, admin_id)
    store.get_or_create_room(room_id)   # also create in chat store

    return ok(room_id=room_id, message=f"Room '{room_id}' created")


@admin_bp.route("/rooms/<room_id>/grant/<user_id>", methods=["POST"])
@require_admin
def grant_access(room_id, user_id):
    user = user_store.get_by_id(user_id)
    if not user:
        return err("User not found", code=404)
    user_store.grant_membership(room_id, user_id)
    store.get_or_create_room(room_id)
    return ok(message=f"Access to '{room_id}' granted to '{user.username}'")


# ─────────────────────────────────────────────────────────────────────────────
# Admin — join request management
# ─────────────────────────────────────────────────────────────────────────────

@admin_bp.route("/join-requests", methods=["GET"])
@require_admin
def list_join_requests():
    reqs = user_store.list_pending_requests()
    return ok(requests=[r.to_dict() for r in reqs])


@admin_bp.route("/join-requests/<request_id>/approve", methods=["POST"])
@require_admin
def approve_request(request_id):
    req = user_store.approve_request(request_id, request.auth["user_id"])
    if not req:
        return err("Request not found", code=404)
    store.get_or_create_room(req.room_id)
    return ok(request=req.to_dict(), message=f"✅ '{req.username}' granted access to '{req.room_id}'")


@admin_bp.route("/join-requests/<request_id>/reject", methods=["POST"])
@require_admin
def reject_request(request_id):
    req = user_store.reject_request(request_id, request.auth["user_id"])
    if not req:
        return err("Request not found", code=404)
    return ok(request=req.to_dict(), message=f"❌ Request from '{req.username}' rejected")


@admin_bp.route("/stats", methods=["GET"])
@require_admin
def stats():
    return ok(**user_store.get_stats())


# ─────────────────────────────────────────────────────────────────────────────
# User-facing endpoints
# ─────────────────────────────────────────────────────────────────────────────

@admin_bp.route("/request-access", methods=["POST"])
@require_auth
def request_access():
    """User submits a request to join a room."""
    body    = request.get_json(silent=True) or {}
    room_id = body.get("room_id", "").strip()
    message = body.get("message", "").strip()

    if not room_id:
        return err("room_id is required")

    auth     = request.auth
    user     = user_store.get_by_id(auth["user_id"])

    if not user or user.status != "approved":
        return err("Your account must be approved first", code=403)

    try:
        req = user_store.create_join_request(
            auth["user_id"], auth["username"], room_id, message
        )
    except ValueError as e:
        return err(str(e))

    return ok(request=req.to_dict(), message="Request submitted — awaiting admin approval")


@admin_bp.route("/my-rooms", methods=["GET"])
@require_auth
def my_rooms():
    user_id  = request.auth["user_id"]
    role     = request.auth["role"]

    if role == "admin":
        # Admin sees all rooms
        rooms = user_store.list_all_rooms()
    else:
        room_ids = user_store.get_user_rooms(user_id)
        rooms    = [{"room_id": rid} for rid in room_ids]

    for room in rooms:
        chat_room = store.get_room(room["room_id"])
        room["message_count"] = chat_room.message_count if chat_room else 0
        room["has_key"]       = (chat_room.key_record is not None) if chat_room else False

    return ok(rooms=rooms)


@admin_bp.route("/my-requests", methods=["GET"])
@require_auth
def my_requests():
    reqs = user_store.list_requests_for_user(request.auth["user_id"])
    return ok(requests=[r.to_dict() for r in reqs])