# backend/config.py
import os
from dotenv import load_dotenv

load_dotenv()

# ── Flask ─────────────────────────────────────────────────────────────────────
SECRET_KEY  = os.getenv("FLASK_SECRET", "dev-secret-change-in-prod")
DEBUG       = os.getenv("FLASK_DEBUG", "false").lower() == "true"
HOST        = os.getenv("HOST", "0.0.0.0")
PORT        = int(os.getenv("PORT", 5000))

# ── CORS ──────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

# ── JWT ───────────────────────────────────────────────────────────────────────
JWT_SECRET       = os.getenv("JWT_SECRET", "jwt-secret-change-in-prod")
JWT_EXPIRY_HOURS = float(os.getenv("JWT_EXPIRY_HOURS", 24))

# ── Quantum BB84 ──────────────────────────────────────────────────────────────
BB84_NUM_QUBITS     = int(os.getenv("BB84_NUM_QUBITS", 256))
BB84_NOISE_ENABLED  = os.getenv("BB84_NOISE", "true").lower() == "true"
BB84_DEPOLAR_PROB   = float(os.getenv("BB84_DEPOLAR", 0.02))
BB84_EAVESDROP_PROB = float(os.getenv("BB84_EAVESDROP", 0.0))
KEY_REFRESH_EVERY   = int(os.getenv("KEY_REFRESH_EVERY", 5))

# ── AES-256-GCM ───────────────────────────────────────────────────────────────
AES_KEY_BYTES   = 32
AES_NONCE_BYTES = 12

# ── SocketIO ──────────────────────────────────────────────────────────────────
SOCKETIO_ASYNC_MODE = "threading"
MAX_ROOMS           = int(os.getenv("MAX_ROOMS", 50))