// frontend/src/App.tsx
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Toaster, toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge }  from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { AuthPage }         from "@/components/AuthPage";
import { AdminDashboard }   from "@/components/AdminDashboard";
import { RoomAccessPage }   from "@/components/RoomAccessPage";
import { ChatWindow }       from "@/components/ChatWindow";
import { QuantumKeyPanel }  from "@/components/QuantumKeyPanel";
import { EncryptionDemo }   from "@/components/EncryptionDemo";
import { P2PKeyPanel }      from "@/components/P2PKeyPanel";

import { useAuth }       from "@/hooks/useAuth";
import { useSocket }     from "@/hooks/useSocket";
import { useQuantumKey } from "@/hooks/useQuantumKey";
import { useAES }        from "@/hooks/useAES";
import { useWebRTC }     from "@/hooks/useWebRTC";
import { useP2PKey }     from "@/hooks/useP2PKey";

import type {
  ChatMessage, RoomJoinedPayload, NewMessagePayload,
  KeyRefreshedPayload, TypingPayload, UserJoinedPayload,
  UserLeftPayload, ReactionUpdatedPayload, MessageReadPayload,
  MessageDeletedPayload, MessageEditedPayload,
  EncryptedPayload,
} from "@/types";
import type { P2PRole, P2PMessageType } from "@/lib/webrtc";

type JoinPhase = "idle" | "connecting" | "joining" | "joined";
const BASE_TITLE = "Quantum-Secure Chat";

// ── Theme helpers (persisted in localStorage, default = dark) ─────────────────
function getInitialTheme(): "dark" | "light" {
  try { return (localStorage.getItem("qsc_theme") as "dark" | "light") ?? "dark"; }
  catch { return "dark"; }
}
function applyTheme(t: "dark" | "light") {
  document.documentElement.classList.toggle("dark", t === "dark");
  try { localStorage.setItem("qsc_theme", t); } catch { /* noop */ }
}

export default function App() {
  // ── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const toggleTheme = useCallback(() => setTheme((t) => t === "dark" ? "light" : "dark"), []);

  // ── Auth ───────────────────────────────────────────────────────────────────
  const auth = useAuth();

  // ── Room/chat state ────────────────────────────────────────────────────────
  const [joinPhase,   setJoinPhase]   = useState<JoinPhase>("idle");
  const [roomId,      setRoomId]      = useState("");
  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [activeTab,   setActiveTab]   = useState("chat");
  const [memberCount, setMemberCount] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);

  const [p2pKeyActive,  setP2pKeyActive]  = useState(false);
  const [p2pKeyHex,     setP2pKeyHex]     = useState("");
  const [p2pKeyVersion, setP2pKeyVersion] = useState(0);

  const pendingJoin = useRef<{ rid: string } | null>(null);
  const roleRef     = useRef<P2PRole | null>(null);
  const sendRef     = useRef<(type: P2PMessageType, payload: unknown) => boolean>(
    () => false
  );

  // ── Unread indicator ────────────────────────────────────────────────────────
  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE;
  }, [unreadCount]);
  useEffect(() => {
    const fn = () => { if (!document.hidden) setUnreadCount(0); };
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);

  // ── Keys ───────────────────────────────────────────────────────────────────
  const qKey = useQuantumKey(roomId);

  const effectiveKeyHexMap = useMemo(() => {
    const m = new Map<number, string>();
    qKey.keyHexMap.forEach((hex, ver) => { if (hex.length === 64) m.set(ver, hex); });
    if (p2pKeyActive && p2pKeyHex.length === 64) m.set(p2pKeyVersion, p2pKeyHex);
    return m;
  }, [qKey.keyHexMap, p2pKeyActive, p2pKeyHex, p2pKeyVersion]);

  const effectiveVersion = p2pKeyActive ? p2pKeyVersion : (qKey.keyInfo?.key_version ?? 0);
  const aes     = useAES(effectiveKeyHexMap, effectiveVersion);
  const decrypt = useCallback(async (p: EncryptedPayload) => aes.decrypt(p), [aes]);

  // ── Socket callbacks ────────────────────────────────────────────────────────
  const handleRoomJoined = useCallback((payload: RoomJoinedPayload) => {
    if (payload.key_history?.length) qKey.importKeyHistory(payload.key_history);
    else if (payload.key_info) qKey.applyKeyFromJoin(payload.key_info, payload.key_info.key_hex);
    setMessages(payload.history ?? []);
    setMemberCount(payload.room_info.member_count);
    setJoinPhase("joined");
    toast.success(`✅ Joined #${payload.room_id}`);
  }, []); // eslint-disable-line

  const handleNewMessage = useCallback((payload: NewMessagePayload) => {
    setMessages((prev) => {
      if (prev.some((m) => m.message_id === payload.message_id)) return prev;
      return [...prev, payload];
    });
    if (document.hidden) {
      setUnreadCount((c) => c + 1);
    } else {
      // Tab is visible — mark as read immediately
      socket.markRead(roomId, payload.message_id);
    }
    if (payload.key_refresh_needed) toast.info("🔑 Key refresh triggered…");
  }, [roomId]); // eslint-disable-line

  const handleMessageRead = useCallback((payload: MessageReadPayload) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.message_id === payload.message_id
          ? { ...msg, read_by: payload.read_by }
          : msg
      )
    );
  }, []);

  const handleMessageDeleted = useCallback((payload: MessageDeletedPayload) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.message_id === payload.message_id
          ? { ...msg, deleted: true, encrypted_payload: { nonce_b64: "", ciphertext_b64: "", timestamp: 0, key_version: 0 } }
          : msg
      )
    );
  }, []);

  const handleMessageEdited = useCallback((payload: MessageEditedPayload) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.message_id === payload.message_id
          ? { ...msg, encrypted_payload: payload.encrypted_payload, edited: true, edited_at: payload.edited_at, decrypted_text: undefined }
          : msg
      )
    );
  }, []);

  const handleKeyRefreshed = useCallback((payload: KeyRefreshedPayload) => {
    qKey.applyRefreshedKey(payload.key_info, payload.key_history);
    toast.success(payload.message, { duration: 4000 });
  }, []); // eslint-disable-line

  const handleTypingEvent = useCallback((payload: TypingPayload) => {
    setTypingUsers((prev) => prev.includes(payload.username) ? prev : [...prev, payload.username]);
    setTimeout(() => setTypingUsers((p) => p.filter((u) => u !== payload.username)), 2000);
  }, []);

  const handleUserJoined = useCallback((payload: UserJoinedPayload) => {
    setMemberCount(payload.members);
    toast.info(`👤 ${payload.username} joined #${payload.room_id}`);
    if (roleRef.current === null) rtcActions.current?.startAsAlice();
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
    onMessageRead:     handleMessageRead,
    onMessageDeleted:  handleMessageDeleted,
    onMessageEdited:   handleMessageEdited,
    onError:           (p) => toast.error(`⚠ ${p.message}`),
  });

  // ── P2P ────────────────────────────────────────────────────────────────────
  const p2p = useP2PKey({ roleRef, sendRef, numQubits: 256, depolar: 0.02 });
  const rtc = useWebRTC({ getSocket: socket.getSocket, roomId, username: auth.user?.username ?? "", onMessage: p2p.handleP2PMessage });
  const rtcActions = useRef({ startAsAlice: rtc.startAsAlice, startAsBob: rtc.startAsBob });
  useEffect(() => { rtcActions.current = { startAsAlice: rtc.startAsAlice, startAsBob: rtc.startAsBob }; }, [rtc.startAsAlice, rtc.startAsBob]);
  useEffect(() => { roleRef.current = rtc.role; }, [rtc.role]);
  useEffect(() => { sendRef.current = rtc.send; }, [rtc.send]);

  const didAssignRole = useRef(false);
  useEffect(() => {
    if (joinPhase === "joined" && memberCount > 1 && roleRef.current === null && !didAssignRole.current) {
      didAssignRole.current = true;
      rtcActions.current.startAsBob();
    }
  }, [joinPhase, memberCount]);

  useEffect(() => {
    if (p2p.status === "complete" && p2p.keyHex.length === 64 && !p2pKeyActive) {
      const ver = 1000 + (qKey.keyInfo?.key_version ?? 0);
      setP2pKeyHex(p2p.keyHex); setP2pKeyVersion(ver); setP2pKeyActive(true);
      toast.success("🔑 P2P key active — server has zero knowledge!", { duration: 6000 });
    }
  }, [p2p.status, p2p.keyHex, p2pKeyActive]); // eslint-disable-line

  // ── Join state machine ──────────────────────────────────────────────────────
  useEffect(() => {
    if (joinPhase === "connecting" && socket.status === "connected") {
      const pj = pendingJoin.current;
      if (pj) {
        pendingJoin.current = null;
        setJoinPhase("joining");
        socket.joinRoom(pj.rid, auth.user?.username ?? "");
      }
    }
  }, [socket.status, joinPhase, socket.joinRoom, auth.user]);

  // ── Enter room (called from AdminDashboard or RoomAccessPage) ──────────────
  const handleEnterRoom = useCallback((rid: string) => {
    if (!auth.token) return;
    setRoomId(rid);
    pendingJoin.current = { rid };

    if (socket.status === "connected") {
      pendingJoin.current = null;
      setJoinPhase("joining");
      socket.joinRoom(rid, auth.user?.username ?? "");
    } else {
      setJoinPhase("connecting");
      socket.connect(auth.token);   // ← JWT passed here
    }
  }, [auth.token, auth.user, socket]);

  const handleSend = useCallback((plaintext: string, ep: EncryptedPayload) => {
    socket.sendMessage(roomId, auth.user?.username ?? "", ep, plaintext);
  }, [socket, roomId, auth.user]);

  const handleTypingEmit = useCallback(() => {
    socket.sendTyping(roomId, auth.user?.username ?? "");
  }, [socket, roomId, auth.user]);

  const handleReact = useCallback((messageId: string, emoji: string) => {
    socket.sendReaction(roomId, messageId, auth.user?.username ?? "", emoji);
  }, [socket, roomId, auth.user]);

  const handleDelete = useCallback((messageId: string) => {
    socket.deleteMessage(roomId, messageId);
  }, [socket, roomId]);

  const handleEdit = useCallback(async (messageId: string, newText: string) => {
    const payload = await aes.encrypt(newText);
    if (payload) socket.editMessage(roomId, messageId, payload);
  }, [socket, roomId, aes]);

  const handleGenerate = useCallback(async (opts: Parameters<typeof qKey.generate>[0]) => {
    await qKey.generate(opts); setActiveTab("chat");
  }, [qKey]);

  const handleLeaveRoom = useCallback(() => {
    socket.leaveRoom(roomId, auth.user?.username ?? "");
    socket.disconnect();
    rtc.destroy(); p2p.reset();
    didAssignRole.current = false;
    setJoinPhase("idle"); setMessages([]); setRoomId("");
    setMemberCount(1); setUnreadCount(0);
    setP2pKeyActive(false); setP2pKeyHex("");
    pendingJoin.current = null;
    document.title = BASE_TITLE;
  }, [socket, rtc, p2p, roomId, auth.user]);

  const hasAnyKey  = p2pKeyActive || qKey.hasKey;
  const keyVersion = p2pKeyActive ? p2pKeyVersion : (qKey.keyInfo?.key_version ?? 0);

  // ── Theme toggle button (fixed, appears on every view) ───────────────────
  const ThemeToggle = (
    <button
      onClick={toggleTheme}
      className="fixed bottom-4 right-4 z-50 w-9 h-9 rounded-full bg-card border border-border shadow-lg flex items-center justify-center text-base hover:border-primary/50 transition-colors"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );

  // ── Render: loading ────────────────────────────────────────────────────────
  if (auth.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        {ThemeToggle}
        <div className="text-center space-y-3">
          <div className="text-4xl animate-pulse">⚛</div>
          <p className="text-slate-400 text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  // ── Render: not authenticated ──────────────────────────────────────────────
  if (auth.status === "unauthenticated") {
    return (
      <>
        {ThemeToggle}
        <AuthPage
          onRegister={auth.register}
          onLogin={auth.login}
          error={auth.error}
        />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  // ── Render: pending approval ───────────────────────────────────────────────
  if (auth.status === "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        {ThemeToggle}
        <div className="text-center space-y-4 max-w-sm">
          <div className="text-5xl">⏳</div>
          <h2 className="text-lg font-semibold text-slate-200">Awaiting Approval</h2>
          <p className="text-sm text-slate-400">
            Hi <strong className="text-primary">{auth.user?.username}</strong>! Your account
            is pending admin approval. You'll be able to log in once the admin approves your account.
          </p>
          <Button variant="outline" onClick={auth.logout} className="border-border text-slate-400">
            Back to login
          </Button>
        </div>
        <Toaster richColors position="top-right" />
      </div>
    );
  }

  // ── Render: admin — not in a room yet ──────────────────────────────────────
  if (auth.user?.role === "admin" && joinPhase === "idle") {
    return (
      <div className="flex flex-col h-screen-safe bg-background overflow-hidden">
        {ThemeToggle}
        <Toaster richColors position="top-right" />
        <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-primary">⚛ Quantum-Secure</span>
            <Badge className="text-[10px] bg-violet-900/60 text-violet-300 border-violet-700/40">👑 admin</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={auth.logout} className="text-xs text-slate-500 hover:text-red-400">
            Sign out
          </Button>
        </header>
        <div className="flex-1 overflow-hidden">
          <AdminDashboard token={auth.token} onEnterRoom={handleEnterRoom} />
        </div>
      </div>
    );
  }

  // ── Render: user — not in a room yet ───────────────────────────────────────
  if (joinPhase === "idle" || joinPhase === "connecting" || joinPhase === "joining") {
    return (
      <>
        {ThemeToggle}
        <RoomAccessPage
          token={auth.token}
          user={auth.user!}
          onEnterRoom={handleEnterRoom}
          onLogout={auth.logout}
        />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  // ── Render: in a room — full chat UI ───────────────────────────────────────
  return (
    <div className="flex flex-col h-screen-safe bg-background overflow-hidden">
      {ThemeToggle}
      <Toaster richColors position="top-right" />

      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80 backdrop-blur-sm z-10 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base font-bold text-primary flex-shrink-0">⚛</span>
          <Badge variant="outline" className="text-[10px] border-border text-slate-500 font-mono truncate max-w-[90px]">
            #{roomId}
          </Badge>
          <Badge variant="outline" className="text-[10px] border-border text-slate-500 hidden sm:flex">
            {auth.user?.username}
          </Badge>
          {auth.user?.role === "admin" && (
            <Badge className="text-[10px] bg-violet-900/60 text-violet-300 border-violet-700/40">👑</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {unreadCount > 0 && (
            <Badge className="text-[10px] bg-red-600 text-white border-0 animate-pulse">
              {unreadCount} new
            </Badge>
          )}
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
          <Button variant="ghost" size="sm" onClick={handleLeaveRoom} className="text-xs text-slate-500 hover:text-red-400 px-2">
            ← Leave
          </Button>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v === "chat") setUnreadCount(0); }} className="flex flex-col flex-1 overflow-hidden min-h-0">
        <TabsList className="grid grid-cols-4 w-full rounded-none border-b border-border bg-card/50 h-9 flex-shrink-0">
          <TabsTrigger value="chat" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary relative">
            💬 Chat
            {unreadCount > 0 && activeTab !== "chat" && <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-red-500" />}
          </TabsTrigger>
          <TabsTrigger value="p2p" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-violet-400 relative">
            🔗 P2P
            {rtc.status === "connected" && p2p.status !== "complete" && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}
          </TabsTrigger>
          <TabsTrigger value="quantum" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">⚛ BB84</TabsTrigger>
          <TabsTrigger value="crypto"  className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">🔐 E2E</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 overflow-hidden m-0 p-0 data-[state=inactive]:hidden min-h-0">
          <ChatWindow roomId={roomId} username={auth.user?.username ?? ""} messages={messages}
            typingUsers={typingUsers} memberCount={memberCount} hasKey={hasAnyKey}
            keyVersion={keyVersion} retryKey={aes.keyCount}
            onSend={handleSend} onTyping={handleTypingEmit} onReact={handleReact}
            onDelete={handleDelete} onEdit={handleEdit}
            decrypt={decrypt} encrypt={aes.encrypt} />
        </TabsContent>
        <TabsContent value="p2p" className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden">
          <P2PKeyPanel role={rtc.role} rtcStatus={rtc.status} keyStatus={p2p.status}
            keyResult={p2p.keyResult} progress={p2p.progress} log={p2p.log}
            onInitiate={p2p.aliceInitiate}
            onReset={() => { p2p.reset(); setP2pKeyActive(false); setP2pKeyHex(""); }} />
        </TabsContent>
        <TabsContent value="quantum" className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden">
          <QuantumKeyPanel roomId={roomId} keyInfo={qKey.keyInfo} bb84Stats={qKey.bb84Stats}
            qberHistory={qKey.qberHistory} generating={qKey.generating} onGenerate={handleGenerate} />
        </TabsContent>
        <TabsContent value="crypto" className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden">
          <EncryptionDemo roomId={roomId} hasKey={hasAnyKey} decrypt={decrypt} />
        </TabsContent>
      </Tabs>
    </div>
  );
}