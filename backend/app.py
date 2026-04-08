# backend/app.py
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

# gevent monkey-patch MUST be first — before any other imports
from gevent import monkey
monkey.patch_all()

from flask import Flask
from flask_socketio import SocketIO
from flask_cors import CORS

from config import (
    SECRET_KEY, DEBUG, HOST, PORT,
    ALLOWED_ORIGINS, SOCKETIO_ASYNC_MODE,
)
from api import api_bp, register_socket_events


def create_app() -> tuple:
    app = Flask(__name__)
    app.secret_key = SECRET_KEY

    CORS(
        app,
        origins=["*"],   # gevent+Railway: allow all, SocketIO handles its own CORS
        supports_credentials=True,
    )

    socketio = SocketIO(
        app,
        cors_allowed_origins = "*",
        async_mode           = SOCKETIO_ASYNC_MODE,  # "gevent"
        logger               = False,
        engineio_logger      = False,
        ping_timeout         = 60,
        ping_interval        = 25,
        # Allow both transports — Railway supports both
        transports           = ["polling", "websocket"],
    )

    app.register_blueprint(api_bp)
    register_socket_events(socketio)

    @app.route("/")
    def index():
        return {
            "service": "Quantum-Secure Chat API",
            "version": "2.0.0",
            "status":  "running",
        }

    return app, socketio


# ── Entry point ───────────────────────────────────────────────────────────────
app, socketio = create_app()

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════════╗
║      Quantum-Secure Chat — Backend           ║
║  http://{HOST}:{PORT}  |  mode: {SOCKETIO_ASYNC_MODE}        ║
╚══════════════════════════════════════════════╝
    """)
    socketio.run(
        app,
        host         = HOST,
        port         = PORT,
        debug        = DEBUG,
        use_reloader = False,
    )