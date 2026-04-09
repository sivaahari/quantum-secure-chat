// frontend/src/hooks/useSocket.ts
import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";
import type {
  ConnectionStatus,
  RoomJoinedPayload,
  NewMessagePayload,
  KeyRefreshedPayload,
  TypingPayload,
  UserJoinedPayload,
  UserLeftPayload,
  ReactionUpdatedPayload,
  EncryptedPayload,
} from "@/types";

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:5000";

export interface SocketCallbacks {
  onRoomJoined?:      (payload: RoomJoinedPayload)      => void;
  onNewMessage?:      (payload: NewMessagePayload)       => void;
  onKeyRefreshed?:    (payload: KeyRefreshedPayload)     => void;
  onTyping?:          (payload: TypingPayload)           => void;
  onUserJoined?:      (payload: UserJoinedPayload)       => void;
  onUserLeft?:        (payload: UserLeftPayload)         => void;
  onReactionUpdated?: (payload: ReactionUpdatedPayload)  => void;
  onError?:           (payload: { message: string })     => void;
}

export function useSocket(callbacks: SocketCallbacks) {
  const socketRef    = useRef<Socket | null>(null);
  const callbacksRef = useRef(callbacks);
  const isConnecting = useRef(false);
  const disconnectTime = useRef<number | null>(null); // track when we lost connection

  const [status,   setStatus]   = useState<ConnectionStatus>("disconnected");
  const [socketId, setSocketId] = useState<string>("");

  // Always keep callbacks current
  useEffect(() => { callbacksRef.current = callbacks; });

  // ── connect ──────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (socketRef.current) {
      console.log("[Socket] Already have socket, skipping connect()");
      return;
    }
    if (isConnecting.current) {
      console.log("[Socket] Already connecting, skipping");
      return;
    }

    isConnecting.current = true;
    setStatus("connecting");
    console.log("[Socket] Creating new socket →", SOCKET_URL);

    const socket = io(SOCKET_URL, {
      transports:           ["polling", "websocket"],
      reconnection:         true,
      reconnectionDelay:    1000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: 20,
      timeout:              15000,
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

      // ── Railway sleep warning ────────────────────────────────────────────
      // Railway free tier "sleeps" the container after ~5 min of inactivity.
      // When it wakes, the socket reconnects. If the disconnect was > 10s ago,
      // the server likely restarted and we warn the user that state may be lost.
      if (disconnectTime.current !== null) {
        const gapSeconds = (Date.now() - disconnectTime.current) / 1000;
        if (gapSeconds > 10) {
          toast.warning(
            `🌙 Server woke up after ${Math.round(gapSeconds)}s sleep. ` +
            "Room state may have reset — regenerate your quantum key.",
            { duration: 8000 }
          );
        }
        disconnectTime.current = null;
      }
    });

    socket.on("disconnect", (reason) => {
      setStatus("disconnected");
      setSocketId("");
      disconnectTime.current = Date.now();   // record when we lost connection
      console.log("[Socket] Disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      isConnecting.current = false;
      setStatus("error");
      console.error("[Socket] ❌ Connection error:", err.message);
    });

    // Fires on every successful reconnection attempt
    socket.io.on("reconnect", (attemptNumber: number) => {
      console.log("[Socket] Reconnected after", attemptNumber, "attempt(s)");
    });

    // ── application events ─────────────────────────────────────────────────

    socket.on("room_joined", (p: RoomJoinedPayload) => {
      console.log("[Socket] 📥 room_joined →", p.room_id, p.username);
      callbacksRef.current.onRoomJoined?.(p);
    });

    socket.on("new_message", (p: NewMessagePayload) => {
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

    socket.on("user_left", (p: UserLeftPayload) => {
      console.log("[Socket] 👤 user_left →", p.username);
      callbacksRef.current.onUserLeft?.(p);
    });

    socket.on("reaction_updated", (p: ReactionUpdatedPayload) => {
      callbacksRef.current.onReactionUpdated?.(p);
    });

    socket.on("error", (p: { message: string }) => {
      console.error("[Socket] ⚠ Server error:", p.message);
      callbacksRef.current.onError?.(p);
    });
  }, []);

  // ── disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    isConnecting.current = false;
    disconnectTime.current = null;
    setStatus("disconnected");
    setSocketId("");
  }, []);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ── emit helpers ──────────────────────────────────────────────────────────

  const joinRoom = useCallback((roomId: string, username: string) => {
    console.log("[Socket] 📤 join_room →", roomId, username);
    socketRef.current?.emit("join_room", { room_id: roomId, username });
  }, []);

  const leaveRoom = useCallback((roomId: string, username: string) => {
    socketRef.current?.emit("leave_room", { room_id: roomId, username });
  }, []);

  const sendMessage = useCallback(
    (
      roomId:           string,
      username:         string,
      encryptedPayload: EncryptedPayload,
      plaintext:        string,
    ) => {
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

  const sendReaction = useCallback(
    (roomId: string, messageId: string, username: string, emoji: string) => {
      socketRef.current?.emit("react_message", {
        room_id:    roomId,
        message_id: messageId,
        username,
        emoji,
      });
    },
    []
  );

  return {
    status,
    socketId,
    connect,
    disconnect,
    joinRoom,
    leaveRoom,
    sendMessage,
    sendTyping,
    sendReaction,
    isConnected: status === "connected",
  };
}