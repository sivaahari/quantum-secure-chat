// frontend/src/App.tsx
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Toaster, toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge }  from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { RoomSelector }    from "@/components/RoomSelector";
import { ChatWindow }      from "@/components/ChatWindow";
import { QuantumKeyPanel } from "@/components/QuantumKeyPanel";
import { EncryptionDemo }  from "@/components/EncryptionDemo";
import { P2PKeyPanel }     from "@/components/P2PKeyPanel";

import { useSocket }     from "@/hooks/useSocket";
import { useQuantumKey } from "@/hooks/useQuantumKey";
import { useAES }        from "@/hooks/useAES";
import { useWebRTC }     from "@/hooks/useWebRTC";
import { useP2PKey }     from "@/hooks/useP2PKey";

import type {
  ChatMessage,
  RoomJoinedPayload,
  NewMessagePayload,
  KeyRefreshedPayload,
  TypingPayload,
  UserJoinedPayload,
  UserLeftPayload,
  ReactionUpdatedPayload,
  EncryptedPayload,
} from "@/types";
import type { P2PRole, P2PMessageType } from "@/lib/webrtc";

type JoinPhase = "idle" | "connecting" | "joining" | "joined";
const BASE_TITLE = "Quantum-Secure Chat";

export default function App() {
  const [joinPhase,   setJoinPhase]   = useState<JoinPhase>("idle");
  const [roomId,      setRoomId]      = useState("");
  const [username,    setUsername]    = useState("");
  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [activeTab,   setActiveTab]   = useState("chat");
  const [memberCount, setMemberCount] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);

  const [p2pKeyActive,  setP2pKeyActive]  = useState(false);
  const [p2pKeyHex,     setP2pKeyHex]     = useState("");
  const [p2pKeyVersion, setP2pKeyVersion] = useState(0);

  const pendingJoin = useRef<{ rid: string; uname: string } | null>(null);
  const roleRef     = useRef<P2PRole | null>(null);
  const sendRef     = useRef<(type: P2PMessageType, payload: unknown) => boolean>(
    () => { console.warn("[sendRef] not ready"); return false; }
  );

  // ── Unread ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE;
  }, [unreadCount]);

  useEffect(() => {
    const fn = () => { if (!document.hidden) setUnreadCount(0); };
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);

  // ── Server key ─────────────────────────────────────────────────────────────
  const qKey = useQuantumKey(roomId);

  // ── Effective key map — memoised, includes BOTH server keys and P2P key ────
  const effectiveKeyHexMap = useMemo(() => {
    const m = new Map<number, string>();
    qKey.keyHexMap.forEach((hex, ver) => { if (hex.length === 64) m.set(ver, hex); });
    if (p2pKeyActive && p2pKeyHex.length === 64) m.set(p2pKeyVersion, p2pKeyHex);
    return m;
  }, [qKey.keyHexMap, p2pKeyActive, p2pKeyHex, p2pKeyVersion]);

  const effectiveVersion = p2pKeyActive ? p2pKeyVersion : (qKey.keyInfo?.key_version ?? 0);

  // ── AES — now also exposes keyCount for retry trigger ─────────────────────
  const aes     = useAES(effectiveKeyHexMap, effectiveVersion);
  const decrypt = useCallback(
    async (payload: EncryptedPayload) => aes.decrypt(payload),
    [aes]
  );

  // ── Socket callbacks ────────────────────────────────────────────────────────
  const handleRoomJoined = useCallback((payload: RoomJoinedPayload) => {
    console.log("[App] room_joined → key_history:", payload.key_history?.map(k => k.key_version));
    if (payload.key_history?.length) {
      qKey.importKeyHistory(payload.key_history);
    } else if (payload.key_info) {
      qKey.applyKeyFromJoin(payload.key_info, payload.key_info.key_hex);
    }
    setMessages(payload.history ?? []);
    setMemberCount(payload.room_info.member_count);
    setJoinPhase("joined");
    toast.success(`✅ Joined #${payload.room_id} as ${payload.username}`);
  }, []); // eslint-disable-line

  const handleNewMessage = useCallback((payload: NewMessagePayload) => {
    setMessages((prev) => {
      if (prev.some((m) => m.message_id === payload.message_id)) return prev;
      return [...prev, payload];
    });
    if (document.hidden) setUnreadCount((c) => c + 1);
    if (payload.key_refresh_needed) toast.info("🔑 Key refresh triggered…");
  }, []);

  const handleKeyRefreshed = useCallback((payload: KeyRefreshedPayload) => {
    qKey.applyRefreshedKey(payload.key_info, payload.key_history);
    toast.success(payload.message, { duration: 4000 });
  }, []); // eslint-disable-line

  const handleTypingEvent = useCallback((payload: TypingPayload) => {
    setTypingUsers((prev) =>
      prev.includes(payload.username) ? prev : [...prev, payload.username]
    );
    setTimeout(() => setTypingUsers((p) => p.filter((u) => u !== payload.username)), 2000);
  }, []);

  const handleUserJoined = useCallback((payload: UserJoinedPayload) => {
    setMemberCount(payload.members);
    toast.info(`👤 ${payload.username} joined #${payload.room_id}`);
    if (roleRef.current === null) {
      console.log("[App] 2nd user joined → Alice");
      rtcActions.current?.startAsAlice();
    }
  }, []); // eslint-disable-line

  const handleUserLeft = useCallback((payload: UserLeftPayload) => {
    setMemberCount(payload.members);
    toast.info(`👤 ${payload.username} left`);
  }, []);

  const handleReactionUpdated = useCallback((payload: ReactionUpdatedPayload) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.message_id === payload.message_id
          ? { ...msg, reactions: payload.reactions }
          : msg
      )
    );
  }, []);

  // ── Socket ─────────────────────────────────────────────────────────────────
  const socket = useSocket({
    onRoomJoined:      handleRoomJoined,
    onNewMessage:      handleNewMessage,
    onKeyRefreshed:    handleKeyRefreshed,
    onTyping:          handleTypingEvent,
    onUserJoined:      handleUserJoined,
    onUserLeft:        handleUserLeft,
    onReactionUpdated: handleReactionUpdated,
    onError:           (p) => toast.error(`⚠ ${p.message}`),
  });

  // ── P2P ────────────────────────────────────────────────────────────────────
  const p2p = useP2PKey({ roleRef, sendRef, numQubits: 256, depolar: 0.02 });
  const rtc = useWebRTC({ getSocket: socket.getSocket, roomId, username, onMessage: p2p.handleP2PMessage });

  const rtcActions = useRef({ startAsAlice: rtc.startAsAlice, startAsBob: rtc.startAsBob });
  useEffect(() => { rtcActions.current = { startAsAlice: rtc.startAsAlice, startAsBob: rtc.startAsBob }; }, [rtc.startAsAlice, rtc.startAsBob]);
  useEffect(() => { roleRef.current = rtc.role; }, [rtc.role]);
  useEffect(() => { sendRef.current = rtc.send; }, [rtc.send]);

  const didAssignRole = useRef(false);
  useEffect(() => {
    if (joinPhase === "joined" && memberCount > 1 && roleRef.current === null && !didAssignRole.current) {
      didAssignRole.current = true;
      console.log("[App] Room has members → Bob");
      rtcActions.current.startAsBob();
    }
  }, [joinPhase, memberCount]);

  useEffect(() => {
    if (p2p.status === "complete" && p2p.keyHex.length === 64 && !p2pKeyActive) {
      const ver = 1000 + (qKey.keyInfo?.key_version ?? 0);
      setP2pKeyHex(p2p.keyHex);
      setP2pKeyVersion(ver);
      setP2pKeyActive(true);
      toast.success("🔑 P2P quantum key active — server has zero knowledge!", { duration: 6000 });
    }
  }, [p2p.status, p2p.keyHex, p2pKeyActive]); // eslint-disable-line

  // ── Join state machine ──────────────────────────────────────────────────────
  useEffect(() => {
    if (joinPhase === "connecting" && socket.status === "connected") {
      const pj = pendingJoin.current;
      if (pj) { pendingJoin.current = null; setJoinPhase("joining"); socket.joinRoom(pj.rid, pj.uname); }
    }
  }, [socket.status, joinPhase, socket.joinRoom]);

  const handleJoin = useCallback((rid: string, uname: string) => {
    if (joinPhase !== "idle") return;
    setRoomId(rid); setUsername(uname);
    pendingJoin.current = { rid, uname };
    if (socket.status === "connected") {
      pendingJoin.current = null; setJoinPhase("joining"); socket.joinRoom(rid, uname);
    } else { setJoinPhase("connecting"); socket.connect(); }
  }, [joinPhase, socket]);

  const handleSend = useCallback((plaintext: string, ep: EncryptedPayload) => {
    socket.sendMessage(roomId, username, ep, plaintext);
  }, [socket, roomId, username]);

  const handleTypingEmit = useCallback(() => socket.sendTyping(roomId, username), [socket, roomId, username]);

  const handleReact = useCallback((messageId: string, emoji: string) => {
    socket.sendReaction(roomId, messageId, username, emoji);
  }, [socket, roomId, username]);

  const handleGenerate = useCallback(async (opts: Parameters<typeof qKey.generate>[0]) => {
    await qKey.generate(opts); setActiveTab("chat");
  }, [qKey]);

  const handleLeave = useCallback(() => {
    socket.leaveRoom(roomId, username); socket.disconnect();
    rtc.destroy(); p2p.reset();
    didAssignRole.current = false;
    setJoinPhase("idle"); setMessages([]); setRoomId(""); setUsername("");
    setMemberCount(1); setUnreadCount(0); setP2pKeyActive(false); setP2pKeyHex("");
    pendingJoin.current = null; document.title = BASE_TITLE;
  }, [socket, rtc, p2p, roomId, username]);

  const hasAnyKey  = p2pKeyActive || qKey.hasKey;
  const keyVersion = p2pKeyActive ? p2pKeyVersion : (qKey.keyInfo?.key_version ?? 0);

  if (joinPhase !== "joined") {
    return (
      <>
        <RoomSelector status={joinPhase === "idle" ? socket.status : "connecting"} onJoin={handleJoin} onConnect={socket.connect} />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  return (
    <div className="flex flex-col h-screen-safe bg-background overflow-hidden">
      <Toaster richColors position="top-right" />

      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80 backdrop-blur-sm z-10 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base font-bold text-primary flex-shrink-0">⚛</span>
          <Badge variant="outline" className="text-[10px] border-border text-slate-500 font-mono truncate max-w-[90px]">#{roomId}</Badge>
          <Badge variant="outline" className="text-[10px] border-border text-slate-500 hidden sm:flex">{username}</Badge>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {unreadCount > 0 && <Badge className="text-[10px] bg-red-600 text-white border-0 animate-pulse">{unreadCount} new</Badge>}
          <div className="flex items-center gap-1">
            <span className={socket.status === "connected" ? "status-dot-green" : socket.status === "connecting" ? "status-dot-yellow" : "status-dot-red"} />
            <span className="text-[10px] text-emerald-400 font-mono hidden sm:block">{memberCount} online</span>
          </div>
          {rtc.status !== "idle" && (
            <div className="flex items-center gap-1">
              <span className={rtc.status === "connected" ? "status-dot-green" : rtc.status === "error" ? "status-dot-red" : "status-dot-yellow"} />
              <span className="text-[10px] text-slate-500 hidden sm:block">p2p</span>
            </div>
          )}
          {hasAnyKey ? (
            <Badge className={`text-[10px] font-mono border ${p2pKeyActive ? "bg-violet-950/60 text-violet-300 border-violet-700/40" : "bg-emerald-950/60 text-emerald-400 border-emerald-800/40"}`}>
              {p2pKeyActive ? "🔗 P2P v" : "🔑 v"}{keyVersion}
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-amber-950/60 text-amber-400 border border-amber-800/40">⚠ No key</Badge>
          )}
          <Button variant="ghost" size="sm" onClick={handleLeave} className="text-xs text-slate-500 hover:text-red-400 px-2">✕</Button>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v === "chat") setUnreadCount(0); }} className="flex flex-col flex-1 overflow-hidden min-h-0">
        <TabsList className="grid grid-cols-4 w-full rounded-none border-b border-border bg-card/50 h-9 flex-shrink-0">
          <TabsTrigger value="chat" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary relative">
            💬 Chat
            {unreadCount > 0 && activeTab !== "chat" && <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-red-500" />}
          </TabsTrigger>
          <TabsTrigger value="p2p" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-violet-400 relative">
            🔗 P2P Key
            {rtc.status === "connected" && p2p.status !== "complete" && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}
          </TabsTrigger>
          <TabsTrigger value="quantum" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">⚛ BB84</TabsTrigger>
          <TabsTrigger value="crypto" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">🔐 E2E</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 overflow-hidden m-0 p-0 data-[state=inactive]:hidden min-h-0">
          <ChatWindow
            roomId={roomId}
            username={username}
            messages={messages}
            typingUsers={typingUsers}
            memberCount={memberCount}
            hasKey={hasAnyKey}
            keyVersion={keyVersion}
            retryKey={aes.keyCount}   {/* ← THE KEY FIX: triggers retry on all bubbles */}
            onSend={handleSend}
            onTyping={handleTypingEmit}
            onReact={handleReact}
            decrypt={decrypt}
            encrypt={aes.encrypt}
          />
        </TabsContent>

        <TabsContent value="p2p" className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden">
          <P2PKeyPanel role={rtc.role} rtcStatus={rtc.status} keyStatus={p2p.status} keyResult={p2p.keyResult} progress={p2p.progress} log={p2p.log} onInitiate={p2p.aliceInitiate} onReset={() => { p2p.reset(); setP2pKeyActive(false); setP2pKeyHex(""); }} />
        </TabsContent>

        <TabsContent value="quantum" className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden">
          <QuantumKeyPanel roomId={roomId} keyInfo={qKey.keyInfo} bb84Stats={qKey.bb84Stats} generating={qKey.generating} onGenerate={handleGenerate} />
        </TabsContent>

        <TabsContent value="crypto" className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden">
          <EncryptionDemo roomId={roomId} hasKey={hasAnyKey} decrypt={decrypt} />
        </TabsContent>
      </Tabs>
    </div>
  );
}