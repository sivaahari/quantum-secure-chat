# backend/app.py
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask
from flask_socketio import SocketIO
from flask_cors import CORS

from config import (
    SECRET_KEY, DEBUG, HOST, PORT,
    ALLOWED_ORIGINS, SOCKETIO_ASYNC_MODE,
)
from api   import api_bp, register_socket_events
from auth  import auth_bp
from admin import admin_bp


def create_app() -> tuple:
    app = Flask(__name__)
    app.secret_key = SECRET_KEY

    CORS(app, origins="*", supports_credentials=True)

    socketio = SocketIO(
        app,
        cors_allowed_origins = "*",
        async_mode           = SOCKETIO_ASYNC_MODE,
        logger               = False,
        engineio_logger      = False,
        ping_timeout         = 60,
        ping_interval        = 25,
    )

    # ── Register blueprints ───────────────────────────────────────────────────
    app.register_blueprint(api_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)

    register_socket_events(socketio)

    @app.route("/")
    def index():
        return {
            "service": "Quantum-Secure Chat API",
            "version": "2.0.0",
            "auth":    "JWT",
        }

    return app, socketio


app, socketio = create_app()

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════════════════╗
║      Quantum-Secure Chat — Backend v2.0              ║
║  Auth: JWT  |  http://{HOST}:{PORT}                  ║
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