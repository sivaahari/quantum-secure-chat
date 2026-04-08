# backend/app.py
"""
Application entry point — Flask + Flask-SocketIO.
Uses threading async mode (eventlet removed — deprecated in 0.41+).
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask
from flask_socketio import SocketIO
from flask_cors import CORS

from config import (
    SECRET_KEY,
    DEBUG,
    HOST,
    PORT,
    ALLOWED_ORIGINS,
    SOCKETIO_ASYNC_MODE,
)
from api import api_bp, register_socket_events


def create_app() -> tuple:
    app = Flask(__name__)
    app.secret_key = SECRET_KEY

    CORS(app, origins=ALLOWED_ORIGINS, supports_credentials=True)

    socketio = SocketIO(
        app,
        cors_allowed_origins = ALLOWED_ORIGINS,
        async_mode           = SOCKETIO_ASYNC_MODE,
        logger               = False,
        engineio_logger      = False,
        ping_timeout         = 60,
        ping_interval        = 25,
    )

    app.register_blueprint(api_bp)
    register_socket_events(socketio)

    @app.route("/")
    def index():
        return {
            "service": "Quantum-LLM Secure Chat API",
            "version": "1.0.0",
            "docs":    "/api/health",
        }

    return app, socketio


if __name__ == "__main__":
    app, socketio = create_app()

    print(f"""
╔══════════════════════════════════════════════════════╗
║        Quantum-LLM Secure Chat — Backend             ║
║  Flask + SocketIO  →  http://{HOST}:{PORT}           ║
║  Async mode        →  {SOCKETIO_ASYNC_MODE}                    ║
║  Debug             →  {DEBUG}                              ║
╚══════════════════════════════════════════════════════╝
    """)

    socketio.run(
        app,
        host         = HOST,
        port         = PORT,
        debug        = DEBUG,
        use_reloader = False,
        allow_unsafe_werkzeug = True,
    )