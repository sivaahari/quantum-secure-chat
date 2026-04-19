# backend/auth/routes.py
"""
Authentication routes — public endpoints (no auth required).

POST /auth/register   → create account (first user = admin)
POST /auth/login      → get JWT token
GET  /auth/me         → verify token + get current user
POST /auth/logout     → (client deletes token; server is stateless)
"""

from flask import Blueprint, request, jsonify
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from .models    import user_store
from .jwt_utils import create_token, verify_token, token_from_request

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")


def ok(**kwargs):
    return jsonify({"ok": True, **kwargs}), 200

def err(msg, code=400):
    return jsonify({"ok": False, "error": msg}), code


@auth_bp.route("/register", methods=["POST"])
def register():
    body     = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    password = body.get("password", "").strip()

    if not username or not password:
        return err("Username and password are required")
    if len(username) < 3:
        return err("Username must be at least 3 characters")
    if len(password) < 6:
        return err("Password must be at least 6 characters")
    if not all(c.isalnum() or c in "-_" for c in username):
        return err("Username: letters, numbers, hyphens, underscores only")

    try:
        user = user_store.create_user(username, password)
    except ValueError as e:
        return err(str(e))

    is_admin = user.role == "admin"
    return ok(
        user    = user.to_dict(),
        message = (
            "Admin account created — you can log in now."
            if is_admin else
            "Registered! Waiting for admin approval before you can log in."
        ),
    )


@auth_bp.route("/login", methods=["POST"])
def login():
    body     = request.get_json(silent=True) or {}
    username = body.get("username", "").strip()
    password = body.get("password", "").strip()

    if not username or not password:
        return err("Username and password are required")

    user = user_store.get_by_username(username)
    if not user or not user.check_password(password):
        return err("Invalid username or password", code=401)

    if user.status == "pending":
        return err(
            "Your account is awaiting admin approval. "
            "Please wait for the admin to approve your registration.",
            code=403,
        )
    if user.status == "rejected":
        return err("Your account registration was rejected.", code=403)

    token = create_token(user.user_id, user.username, user.role)
    return ok(token=token, user=user.to_dict())


@auth_bp.route("/me", methods=["GET"])
def me():
    token = token_from_request(request)
    if not token:
        return err("No token", code=401)

    payload = verify_token(token)
    if not payload:
        return err("Invalid or expired token", code=401)

    user = user_store.get_by_id(payload["user_id"])
    if not user:
        return err("User not found", code=404)

    return ok(user=user.to_dict())


@auth_bp.route("/logout", methods=["POST"])
def logout():
    # JWT is stateless — client deletes the token locally
    return ok(message="Logged out")