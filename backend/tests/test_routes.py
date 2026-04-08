# backend/tests/test_routes.py
"""
Integration tests for Flask REST API routes.
Uses Flask test client — no real network calls.
Run: pytest backend/tests/test_routes.py -v
"""

import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Patch eventlet BEFORE importing app (prevents monkey-patch in test env)
import eventlet
# Override it with a dummy function that does nothing
eventlet.monkey_patch = lambda *args, **kwargs: None

# Override async mode so SocketIO works in tests without eventlet
os.environ["FLASK_DEBUG"] = "false"


@pytest.fixture(scope="module")
def client():
    """Create a Flask test client with threading async mode."""
    # Patch SOCKETIO_ASYNC_MODE to threading for tests
    import config
    config.SOCKETIO_ASYNC_MODE = "threading"

    from app import create_app
    app, socketio = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture(scope="module")
def room_with_key(client):
    """Create a room and generate a BB84 key — reused across tests."""
    # Create room
    rv = client.post("/api/rooms", json={"room_id": "test-room"})
    assert rv.status_code == 200

    # Generate key (uses smaller qubit count for speed in tests)
    rv = client.post("/api/quantum/generate-key", json={
        "room_id":      "test-room",
        "num_qubits":   64,
        "noise_enabled": False,
    })
    assert rv.status_code == 200
    return rv.get_json()


# ─────────────────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_200(self, client):
        rv = client.get("/api/health")
        assert rv.status_code == 200

    def test_health_has_flask_status(self, client):
        data = client.get("/api/health").get_json()
        assert data["flask_status"] == "running"

    def test_health_has_ollama_field(self, client):
        data = client.get("/api/health").get_json()
        assert "ollama_ok" in data


class TestRooms:
    def test_create_room_explicit_id(self, client):
        rv   = client.post("/api/rooms", json={"room_id": "my-room"})
        data = rv.get_json()
        assert rv.status_code == 200
        assert data["ok"] is True
        assert data["room"]["room_id"] == "my-room"

    def test_create_room_auto_id(self, client):
        rv   = client.post("/api/rooms", json={})
        data = rv.get_json()
        assert rv.status_code == 200
        assert data["room"]["room_id"].startswith("room-")

    def test_list_rooms(self, client):
        client.post("/api/rooms", json={"room_id": "list-test"})
        rv   = client.get("/api/rooms")
        data = rv.get_json()
        assert rv.status_code == 200
        assert isinstance(data["rooms"], list)

    def test_delete_room(self, client):
        client.post("/api/rooms", json={"room_id": "delete-me"})
        rv = client.delete("/api/rooms/delete-me")
        assert rv.status_code == 200
        assert rv.get_json()["deleted"] is True

    def test_delete_nonexistent_room(self, client):
        rv = client.delete("/api/rooms/does-not-exist")
        assert rv.status_code == 404


class TestQuantumKeyGeneration:
    def test_generate_key_success(self, room_with_key):
        data = room_with_key
        assert data["ok"] is True
        assert data["bb84"]["final_key_hex"] != ""
        assert data["key_info"]["key_version"] >= 1

    def test_generate_key_has_bloch_vectors(self, room_with_key):
        vecs = room_with_key["bb84"]["bloch_vectors"]
        assert isinstance(vecs, list)
        assert len(vecs) > 0
        assert "x" in vecs[0]

    def test_generate_key_has_qber(self, room_with_key):
        assert "qber" in room_with_key["bb84"]
        assert room_with_key["bb84"]["qber_safe"] is True

    def test_key_info_endpoint(self, client, room_with_key):
        rv   = client.get("/api/quantum/key-info/test-room")
        data = rv.get_json()
        assert rv.status_code == 200
        assert data["ok"] is True
        assert data["key_info"]["qber_safe"] is True

    def test_key_info_missing_room(self, client):
        rv = client.get("/api/quantum/key-info/no-such-room")
        assert rv.status_code == 404


class TestEncryptionDemo:
    def test_encrypt_demo(self, client, room_with_key):
        rv = client.post("/api/crypto/encrypt-demo", json={
            "room_id":   "test-room",
            "plaintext": "Hello Quantum!",
        })
        data = rv.get_json()
        assert rv.status_code == 200
        assert data["ok"] is True
        assert "nonce_b64" in data["encrypted"]

    def test_decrypt_demo_roundtrip(self, client, room_with_key):
        # Encrypt
        enc_rv = client.post("/api/crypto/encrypt-demo", json={
            "room_id":   "test-room",
            "plaintext": "Roundtrip test!",
        })
        enc_data = enc_rv.get_json()

        # Decrypt
        dec_rv = client.post("/api/crypto/decrypt-demo", json={
            "room_id": "test-room",
            "payload": enc_data["encrypted"],
        })
        dec_data = dec_rv.get_json()

        assert dec_rv.status_code == 200
        assert dec_data["plaintext"] == "Roundtrip test!"

    def test_encrypt_no_key_returns_404(self, client):
        rv = client.post("/api/crypto/encrypt-demo", json={
            "room_id":   "no-key-room",
            "plaintext": "test",
        })
        assert rv.status_code == 404


class TestMessages:
    def test_get_messages_empty(self, client):
        client.post("/api/rooms", json={"room_id": "msg-test"})
        rv   = client.get("/api/messages/msg-test")
        data = rv.get_json()
        assert rv.status_code == 200
        assert data["messages"] == []

    def test_get_messages_limit(self, client):
        rv   = client.get("/api/messages/test-room?limit=5")
        data = rv.get_json()
        assert rv.status_code == 200
        assert len(data["messages"]) <= 5


class TestStats:
    def test_stats_endpoint(self, client):
        rv   = client.get("/api/stats")
        data = rv.get_json()
        assert rv.status_code == 200
        assert "total_rooms" in data
        assert "total_messages" in data