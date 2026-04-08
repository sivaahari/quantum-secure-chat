# backend/api/__init__.py
from .routes import api_bp
from .socket_events import register_socket_events

__all__ = ["api_bp", "register_socket_events"]