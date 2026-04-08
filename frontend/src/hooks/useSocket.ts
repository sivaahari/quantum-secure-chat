// frontend/src/hooks/useSocket.ts
import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  ConnectionStatus,
  RoomJoinedPayload,
  NewMessagePayload,
  KeyRefreshedPayload,
  TypingPayload,
  UserJoinedPayload,
  EncryptedPayload,
} from "@/types";

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:5000";

export interface SocketCallbacks {
  onRoomJoined?:  (payload: RoomJoinedPayload) => void;
  onNewMessage?:  (payload: NewMessagePayload) => void;
  onKeyRefreshed?:(payload: KeyRefreshedPayload) => void;
  onTyping?:      (payload: TypingPayload) => void;
  onUserJoined?:  (payload: UserJoinedPayload) => void;
  onUserLeft?:    (payload: { room_id: string; username: string }) => void;
  onError?:       (payload: { message: string }) => void;
}

export function useSocket(callbacks: SocketCallbacks) {
  const socketRef    = useRef<Socket | null>(null);
  const callbacksRef = useRef(callbacks);
  const isConnecting = useRef(false);   // guard against double-connect

  const [status,   setStatus]   = useState<ConnectionStatus>("disconnected");
  const [socketId, setSocketId] = useState<string>("");

  // Always keep callbacks fresh
  useEffect(() => { callbacksRef.current = callbacks; });

  // ── connect ──────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    // Guard: don't create a second socket if one already exists
    if (socketRef.current) {
      console.log("[Socket] Already have socket, skipping connect()");
      return;
    }
    if (isConnecting.current) {
      console.log("[Socket] Already connecting, skipping connect()");
      return;
    }

    isConnecting.current = true;
    console.log("[Socket] Creating new socket → ", SOCKET_URL);
    setStatus("connecting");

    const socket = io(SOCKET_URL, {
      transports:           ["polling", "websocket"],
      reconnection:         true,
      reconnectionDelay:    1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      timeout:              10000,
      forceNew:             false,
      withCredentials:      false,
    });

    socketRef.current = socket;

    // ── lifecycle ──────────────────────────────────────────────────────────
    socket.on("connect", () => {
      isConnecting.current = false;
      setStatus("connected");
      setSocketId(socket.id ?? "");
      console.log("[Socket] ✅ Connected:", socket.id);
    });

    socket.on("disconnect", (reason) => {
      setStatus("disconnected");
      setSocketId("");
      console.log("[Socket] Disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      isConnecting.current = false;
      setStatus("error");
      console.error("[Socket] ❌ Connection error:", err.message);
    });

    // ── application events ─────────────────────────────────────────────────
    socket.on("room_joined", (p: RoomJoinedPayload) => {
      console.log("[Socket] 📥 room_joined →", p.room_id, p.username);
      callbacksRef.current.onRoomJoined?.(p);
    });

    socket.on("new_message", (p: NewMessagePayload) => {
      console.log("[Socket] 📥 new_message →", p.message_id);
      callbacksRef.current.onNewMessage?.(p);
    });

    socket.on("key_refreshed", (p: KeyRefreshedPayload) => {
      console.log("[Socket] 🔑 key_refreshed → v", p.key_info.key_version);
      callbacksRef.current.onKeyRefreshed?.(p);
    });

    socket.on("typing_indicator", (p: TypingPayload) => {
      callbacksRef.current.onTyping?.(p);
    });

    socket.on("user_joined", (p: UserJoinedPayload) => {
      console.log("[Socket] 👤 user_joined →", p.username);
      callbacksRef.current.onUserJoined?.(p);
    });

    socket.on("user_left", (p) => {
      callbacksRef.current.onUserLeft?.(p);
    });

    socket.on("error", (p: { message: string }) => {
      console.error("[Socket] ⚠ Server error:", p.message);
      callbacksRef.current.onError?.(p);
    });
  }, []);   // empty deps — intentional, socket is managed via ref

  // ── disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    isConnecting.current = false;
    setStatus("disconnected");
    setSocketId("");
    console.log("[Socket] Manually disconnected");
  }, []);

  // Cleanup only on component unmount (NOT on every render)
  useEffect(() => {
    return () => {
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);  // empty deps = only on unmount

  // ── emit helpers ──────────────────────────────────────────────────────────
  const joinRoom = useCallback((roomId: string, username: string) => {
  const socket = socketRef.current;

  if (!socket) {
    console.error("[Socket] No socket instance");
    return;
  }

  if (socket.connected) {
    console.log("[Socket] 📤 Emitting join_room (connected)");
    socket.emit("join_room", { room_id: roomId, username });
  } else {
    console.log("[Socket] Waiting for connect before join...");

    socket.once("connect", () => {
      console.log("[Socket] ✅ Connected → now joining");
      socket.emit("join_room", { room_id: roomId, username });
    });
  }
}, []);

  const leaveRoom = useCallback((roomId: string, username: string) => {
    socketRef.current?.emit("leave_room", { room_id: roomId, username });
  }, []);

  const sendMessage = useCallback(
    (roomId: string, username: string, encryptedPayload: EncryptedPayload, plaintext: string) => {
      socketRef.current?.emit("send_message", {
        room_id:           roomId,
        username,
        encrypted_payload: encryptedPayload,
        plaintext,
      });
    },
    []
  );

  const sendTyping = useCallback((roomId: string, username: string) => {
    socketRef.current?.emit("typing", { room_id: roomId, username });
  }, []);

  const getSocket = useCallback(() => socketRef.current, []);

  return {
    status,
    socketId,
    connect,
    disconnect,
    joinRoom,
    leaveRoom,
    sendMessage,
    sendTyping,
    getSocket,
    isConnected: status === "connected",
  };
}