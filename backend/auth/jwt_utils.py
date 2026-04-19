# backend/auth/jwt_utils.py
"""JWT creation and verification for Quantum-Secure Chat auth."""

import time
import sys
import os

import jwt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from config import JWT_SECRET, JWT_EXPIRY_HOURS


def create_token(user_id: str, username: str, role: str) -> str:
    payload = {
        "user_id":  user_id,
        "username": username,
        "role":     role,
        "iat":      int(time.time()),
        "exp":      int(time.time()) + int(JWT_EXPIRY_HOURS * 3600),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_token(token: str) -> dict | None:
    """Returns decoded payload or None if invalid/expired."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def token_from_request(request) -> str | None:
    """Extract token from 'Authorization: Bearer <token>' header."""
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return None