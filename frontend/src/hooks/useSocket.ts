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
  MessageReadPayload,
  MessageDeletedPayload,
  MessageEditedPayload,
  EncryptedPayload,
} from "@/types";

const SOCKET_URL = (import.meta.env.VITE_BACKEND_URL ?? "http://localhost:5000").replace(/\/$/, "");

export interface SocketCallbacks {
  onRoomJoined?:      (payload: RoomJoinedPayload)     => void;
  onNewMessage?:      (payload: NewMessagePayload)      => void;
  onKeyRefreshed?:    (payload: KeyRefreshedPayload)    => void;
  onTyping?:          (payload: TypingPayload)          => void;
  onUserJoined?:      (payload: UserJoinedPayload)      => void;
  onUserLeft?:        (payload: UserLeftPayload)        => void;
  onReactionUpdated?: (payload: ReactionUpdatedPayload) => void;
  onMessageRead?:     (payload: MessageReadPayload)     => void;
  onMessageDeleted?:  (payload: MessageDeletedPayload)  => void;
  onMessageEdited?:   (payload: MessageEditedPayload)   => void;
  onError?:           (payload: { message: string })    => void;
}

export function useSocket(callbacks: SocketCallbacks) {
  const socketRef      = useRef<Socket | null>(null);
  const callbacksRef   = useRef(callbacks);
  const isConnecting   = useRef(false);
  const disconnectTime = useRef<number | null>(null);

  const [status,   setStatus]   = useState<ConnectionStatus>("disconnected");
  const [socketId, setSocketId] = useState<string>("");

  useEffect(() => { callbacksRef.current = callbacks; });

  // ── connect ──────────────────────────────────────────────────────────────
  const connect = useCallback((token: string) => {   // ← add token param
    if (socketRef.current) return;
    if (isConnecting.current) return;

    isConnecting.current = true;
    setStatus("connecting");

    const socket = io(SOCKET_URL, {
      transports:           ["polling", "websocket"],
      reconnection:         true,
      reconnectionDelay:    1000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: 20,
      timeout:              15000,
      auth: { token },      // ← JWT passed here — verified in on_connect
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      isConnecting.current = false;
      setStatus("connected");
      setSocketId(socket.id ?? "");
      console.log("[Socket] ✅ Connected:", socket.id);

      if (disconnectTime.current !== null) {
        const gap = (Date.now() - disconnectTime.current) / 1000;
        if (gap > 10) {
          toast.warning(
            `🌙 Server woke after ${Math.round(gap)}s — regenerate your quantum key.`,
            { duration: 8000 }
          );
        }
        disconnectTime.current = null;
      }
    });

    socket.on("disconnect", (reason) => {
      setStatus("disconnected");
      setSocketId("");
      disconnectTime.current = Date.now();
      console.log("[Socket] Disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      isConnecting.current = false;
      setStatus("error");
      console.error("[Socket] ❌ Error:", err.message);
    });

    socket.on("room_joined",      (p) => callbacksRef.current.onRoomJoined?.(p));
    socket.on("new_message",      (p) => callbacksRef.current.onNewMessage?.(p));
    socket.on("key_refreshed",    (p) => callbacksRef.current.onKeyRefreshed?.(p));
    socket.on("typing_indicator", (p) => callbacksRef.current.onTyping?.(p));
    socket.on("user_joined",      (p) => callbacksRef.current.onUserJoined?.(p));
    socket.on("user_left",        (p) => callbacksRef.current.onUserLeft?.(p));
    socket.on("reaction_updated", (p) => callbacksRef.current.onReactionUpdated?.(p));
    socket.on("message_read",    (p) => callbacksRef.current.onMessageRead?.(p));
    socket.on("message_deleted", (p) => callbacksRef.current.onMessageDeleted?.(p));
    socket.on("message_edited",  (p) => callbacksRef.current.onMessageEdited?.(p));
    socket.on("error",           (p) => callbacksRef.current.onError?.(p));
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    isConnecting.current   = false;
    disconnectTime.current = null;
    setStatus("disconnected");
    setSocketId("");
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ── Expose raw socket for WebRTC signaling ────────────────────────────────
  const getSocket = useCallback((): Socket | null => socketRef.current, []);

  // ── Emit helpers ──────────────────────────────────────────────────────────
  const joinRoom = useCallback((roomId: string, username: string) => {
    console.log("[Socket] 📤 join_room →", roomId, username);
    socketRef.current?.emit("join_room", { room_id: roomId, username });
  }, []);

  const leaveRoom = useCallback((roomId: string, username: string) => {
    socketRef.current?.emit("leave_room", { room_id: roomId, username });
  }, []);

  const sendMessage = useCallback(
    (roomId: string, username: string, encryptedPayload: EncryptedPayload, plaintext: string) => {
      socketRef.current?.emit("send_message", {
        room_id: roomId, username, encrypted_payload: encryptedPayload, plaintext,
      });
    }, []
  );

  const sendTyping = useCallback((roomId: string, username: string) => {
    socketRef.current?.emit("typing", { room_id: roomId, username });
  }, []);

  const sendReaction = useCallback(
    (roomId: string, messageId: string, username: string, emoji: string) => {
      socketRef.current?.emit("react_message", {
        room_id: roomId, message_id: messageId, username, emoji,
      });
    }, []
  );

  const markRead = useCallback((roomId: string, messageId: string) => {
    socketRef.current?.emit("mark_read", { room_id: roomId, message_id: messageId });
  }, []);

  const deleteMessage = useCallback((roomId: string, messageId: string) => {
    socketRef.current?.emit("delete_message", { room_id: roomId, message_id: messageId });
  }, []);

  const editMessage = useCallback((roomId: string, messageId: string, encryptedPayload: EncryptedPayload) => {
    socketRef.current?.emit("edit_message", { room_id: roomId, message_id: messageId, encrypted_payload: encryptedPayload });
  }, []);

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
    markRead,
    deleteMessage,
    editMessage,
    getSocket,          // ← WebRTC uses this to access the raw Socket instance
    isConnected: status === "connected",
  };
}