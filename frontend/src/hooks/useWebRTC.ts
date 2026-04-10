// frontend/src/hooks/useWebRTC.ts
/**
 * WebRTC peer connection hook.
 *
 * Key fixes from v1:
 *  - Accepts a `getSocket` function instead of a Socket directly,
 *    so it can lazily grab the socket after it connects
 *  - `startAsAlice` / `startAsBob` are now stable (no deps that cause re-renders)
 *  - Proper cleanup on destroy
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { Socket } from "socket.io-client";
import { WebRTCManager, type P2PRole, type P2PMessage } from "@/lib/webrtc";

export type RTCStatus =
  | "idle"
  | "signaling"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface UseWebRTCProps {
  getSocket:  () => Socket | null;   // ← lazy getter, not a direct socket ref
  roomId:     string;
  username:   string;
  onMessage:  (msg: P2PMessage) => void;
}

export function useWebRTC({ getSocket, roomId, username, onMessage }: UseWebRTCProps) {
  const managerRef   = useRef<WebRTCManager | null>(null);
  const onMessageRef = useRef(onMessage);
  const [status, setStatus] = useState<RTCStatus>("idle");
  const [role,   setRole]   = useState<P2PRole | null>(null);

  // Keep callback fresh without tearing down the connection
  useEffect(() => { onMessageRef.current = onMessage; });

  // ── Internal: create the manager ─────────────────────────────────────────
  const _createManager = useCallback((p2pRole: P2PRole) => {
    const socket = getSocket();
    if (!socket) {
      console.error("[useWebRTC] No socket available for signaling");
      setStatus("error");
      return null;
    }
    if (managerRef.current) {
      console.log("[useWebRTC] Manager already exists, skipping");
      return managerRef.current;
    }

    console.log("[useWebRTC] Creating WebRTCManager as", p2pRole);
    const mgr = new WebRTCManager({
      socket,
      roomId,
      username,
      role: p2pRole,
      onMessage:      (msg) => onMessageRef.current(msg),
      onConnected:    () => { setStatus("connected"); console.log("[useWebRTC] ✅ P2P connected"); },
      onDisconnected: () => { setStatus("disconnected"); },
      onError:        (err) => { setStatus("error"); console.error("[useWebRTC]", err); },
    });
    managerRef.current = mgr;
    return mgr;
  }, [getSocket, roomId, username]);

  // ── Alice: create offer, wait for Bob ────────────────────────────────────
  const startAsAlice = useCallback(() => {
    if (managerRef.current) return;   // already started
    setRole("alice");
    setStatus("signaling");
    const mgr = _createManager("alice");
    // Alice initiates connection immediately
    mgr?.initiateConnection();
  }, [_createManager]);

  // ── Bob: answer Alice's offer ────────────────────────────────────────────
  const startAsBob = useCallback(() => {
    if (managerRef.current) return;   // already started
    setRole("bob");
    setStatus("signaling");
    const mgr = _createManager("bob");
    if (!mgr) return;
    // Bob announces he's ready — Alice will send the offer
    getSocket()?.emit("webrtc_ready", { room_id: roomId, username });
  }, [_createManager, getSocket, roomId, username]);

  // ── Send through DataChannel ─────────────────────────────────────────────
  const send = useCallback((type: PMessage["type"], payload: unknown): boolean => {
    return managerRef.current?.send(type, payload) ?? false;
  }, []);

  // ── Destroy ───────────────────────────────────────────────────────────────
  const destroy = useCallback(() => {
    managerRef.current?.destroy();
    managerRef.current = null;
    setStatus("idle");
    setRole(null);
  }, []);

  useEffect(() => () => { managerRef.current?.destroy(); }, []);

  return { status, role, startAsAlice, startAsBob, send, destroy, isConnected: status === "connected" };
}

// local alias so the send type resolves
type PMessage = PMessage2;
interface PMessage2 { type: import("@/lib/webrtc").P2PMessageType; payload: unknown; ts: number; }