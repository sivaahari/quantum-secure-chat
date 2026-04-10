// frontend/src/App.tsx
/**
 * Main app — all hooks wired correctly.
 *
 * P2P wiring fixes:
 *  1. socket.getSocket() passed to useWebRTC (not a stale ref)
 *  2. roleRef and sendRef shared between useWebRTC and useP2PKey
 *     so useP2PKey always has the current role and send function
 *  3. Role detection: first joiner = Alice (sees member_count go 1→2),
 *     late joiner = Bob (joins room that already has members)
 *  4. Alice auto-initiates when Bob announces ready (handled in WebRTCManager)
 */

import { useState, useCallback, useRef, useEffect } from "react";
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

  // P2P state
  const [p2pKeyActive,   setP2pKeyActive]   = useState(false);
  const [p2pKeyHex,      setP2pKeyHex]      = useState("");
  const [p2pKeyVersion,  setP2pKeyVersion]  = useState(0);

  const pendingJoin = useRef<{ rid: string; uname: string } | null>(null);

  // ── Refs shared between useWebRTC and useP2PKey ───────────────────────────
  // These refs are the bridge: useWebRTC writes to them, useP2PKey reads them.
  // Using refs (not state) avoids stale closure bugs in async message handlers.
  const roleRef = useRef<P2PRole | null>(null);
  const sendRef = useRef<(type: P2PMessageType, payload: unknown) => boolean>(
    () => { console.warn("[sendRef] send called before WebRTC ready"); return false; }
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

  // ── Server-side quantum key ─────────────────────────────────────────────────
  const qKey = useQuantumKey(roomId);

  // ── Effective key map: P2P key takes priority over server key ─────────────
  const effectiveKeyHexMap = (() => {
    if (p2pKeyActive && p2pKeyHex.length === 64) {
      const m = new Map<number, string>();
      m.set(p2pKeyVersion, p2pKeyHex);
      // Also keep server keys so history messages still decrypt
      qKey.keyHexMap.forEach((hex, ver) => m.set(ver, hex));
      return m;
    }
    return qKey.keyHexMap;
  })();

  const effectiveVersion = p2pKeyActive ? p2pKeyVersion : (qKey.keyInfo?.key_version ?? 0);

  // ── AES ───────────────────────────────────────────────────────────────────
  const aes = useAES(effectiveKeyHexMap, effectiveVersion);
  const decrypt = useCallback(
    async (payload: EncryptedPayload) => aes.decrypt(payload),
    [aes]
  );

  // ── Socket ────────────────────────────────────────────────────────────────
  const socket = useSocket({
    onRoomJoined: useCallback((payload: RoomJoinedPayload) => {
      if (payload.key_history?.length) {
        qKey.importKeyHistory(payload.key_history);
      } else if (payload.key_info) {
        qKey.applyKeyFromJoin(payload.key_info, payload.key_info.key_hex);
      }
      setMessages(payload.history ?? []);
      setMemberCount(payload.room_info.member_count);
      setJoinPhase("joined");
      toast.success(`✅ Joined #${payload.room_id} as ${payload.username}`);
    }, []), // eslint-disable-line

    onNewMessage: useCallback((payload: NewMessagePayload) => {
      setMessages((prev) => {
        if (prev.some((m) => m.message_id === payload.message_id)) return prev;
        return [...prev, payload];
      });
      if (document.hidden) setUnreadCount((c) => c + 1);
      if (payload.key_refresh_needed) toast.info("🔑 Key refresh triggered…");
    }, []),

    onKeyRefreshed: useCallback((payload: KeyRefreshedPayload) => {
      qKey.applyRefreshedKey(payload.key_info, payload.key_history);
      toast.success(payload.message, { duration: 4000 });
    }, []), // eslint-disable-line

    onTyping: useCallback((payload: TypingPayload) => {
      setTypingUsers((prev) =>
        prev.includes(payload.username) ? prev : [...prev, payload.username]
      );
      setTimeout(() => setTypingUsers((p) => p.filter((u) => u !== payload.username)), 2000);
    }, []),

    onUserJoined: useCallback((payload: UserJoinedPayload) => {
      setMemberCount(payload.members);
      toast.info(`👤 ${payload.username} joined #${payload.room_id}`);

      // ── Role detection: if we were already alone and someone just joined ──
      // → we are Alice (the first/initiating peer)
      // This check: roleRef.current === null means we haven't picked a role yet
      if (roleRef.current === null) {
        console.log("[App] Second user joined → I am Alice, starting WebRTC");
        rtcActions.current?.startAsAlice();
      }
    }, []), // eslint-disable-line

    onUserLeft: useCallback((payload: UserLeftPayload) => {
      setMemberCount(payload.members);
      toast.info(`👤 ${payload.username} left`);
    }, []),

    onReactionUpdated: useCallback((payload: ReactionUpdatedPayload) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.message_id === payload.message_id
            ? { ...msg, reactions: payload.reactions }
            : msg
        )
      );
    }, []),

    onError: useCallback((p: { message: string }) => toast.error(`⚠ ${p.message}`), []),
  });

  // ── P2P Key (uses roleRef and sendRef — no circular deps) ─────────────────
  const p2p = useP2PKey({ roleRef, sendRef, numQubits: 256, depolar: 0.02 });

  // ── WebRTC (writes to roleRef and sendRef) ────────────────────────────────
  const rtc = useWebRTC({
    getSocket: socket.getSocket,
    roomId,
    username,
    onMessage: p2p.handleP2PMessage,
  });

  // Store rtc actions in a ref so onUserJoined (which is a stable callback)
  // can call rtc.startAsAlice without capturing a stale closure
  const rtcActions = useRef({ startAsAlice: rtc.startAsAlice, startAsBob: rtc.startAsBob });
  useEffect(() => {
    rtcActions.current = { startAsAlice: rtc.startAsAlice, startAsBob: rtc.startAsBob };
  }, [rtc.startAsAlice, rtc.startAsBob]);

  // Keep roleRef and sendRef in sync with rtc state
  useEffect(() => {
    roleRef.current = rtc.role;
  }, [rtc.role]);

  useEffect(() => {
    sendRef.current = rtc.send;
  }, [rtc.send]);

  // ── Bob detection: if we JOIN a room that already has members → Bob ────────
  // This runs once after "joined" phase is set and memberCount > 1
  const didAssignRole = useRef(false);
  useEffect(() => {
    if (
      joinPhase === "joined" &&
      memberCount > 1 &&
      roleRef.current === null &&
      !didAssignRole.current
    ) {
      didAssignRole.current = true;
      console.log("[App] Room already has members → I am Bob, starting WebRTC");
      rtcActions.current.startAsBob();
    }
  }, [joinPhase, memberCount]);

  // Reset role assignment flag on leave
  const resetRoleFlag = useCallback(() => {
    didAssignRole.current = false;
  }, []);

  // ── Activate P2P key once exchange is complete ─────────────────────────────
  useEffect(() => {
    if (p2p.status === "complete" && p2p.keyHex.length === 64 && !p2pKeyActive) {
      // Put P2P key in a separate version namespace (1000+) to avoid colliding
      // with server key versions (1, 2, 3…)
      const ver = 1000 + (qKey.keyInfo?.key_version ?? 0);
      setP2pKeyHex(p2p.keyHex);
      setP2pKeyVersion(ver);
      setP2pKeyActive(true);
      toast.success("🔑 P2P key is now active — server has ZERO knowledge of this key!", {
        duration: 6000,
      });
    }
  }, [p2p.status, p2p.keyHex, p2pKeyActive, qKey.keyInfo?.key_version]);

  // ── Join state machine ──────────────────────────────────────────────────────
  useEffect(() => {
    if (joinPhase === "connecting" && socket.status === "connected") {
      const pj = pendingJoin.current;
      if (pj) {
        pendingJoin.current = null;
        setJoinPhase("joining");
        socket.joinRoom(pj.rid, pj.uname);
      }
    }
  }, [socket.status, joinPhase, socket.joinRoom]);

  const handleJoin = useCallback(
    (rid: string, uname: string) => {
      if (joinPhase !== "idle") return;
      setRoomId(rid);
      setUsername(uname);
      pendingJoin.current = { rid, uname };
      if (socket.status === "connected") {
        pendingJoin.current = null;
        setJoinPhase("joining");
        socket.joinRoom(rid, uname);
      } else {
        setJoinPhase("connecting");
        socket.connect();
      }
    },
    [joinPhase, socket]
  );

  // ── Messaging ────────────────────────────────────────────────────────────────
  const handleSend = useCallback(
    (plaintext: string, encryptedPayload: EncryptedPayload) => {
      socket.sendMessage(roomId, username, encryptedPayload, plaintext);
    },
    [socket, roomId, username]
  );

  const handleTypingEmit = useCallback(() => {
    socket.sendTyping(roomId, username);
  }, [socket, roomId, username]);

  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      socket.sendReaction(roomId, messageId, username, emoji);
    },
    [socket, roomId, username]
  );

  const handleGenerate = useCallback(
    async (opts: Parameters<typeof qKey.generate>[0]) => {
      await qKey.generate(opts);
      setActiveTab("chat");
    },
    [qKey]
  );

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    socket.leaveRoom(roomId, username);
    socket.disconnect();
    rtc.destroy();
    p2p.reset();
    resetRoleFlag();
    setJoinPhase("idle");
    setMessages([]);
    setRoomId("");
    setUsername("");
    setMemberCount(1);
    setUnreadCount(0);
    setP2pKeyActive(false);
    setP2pKeyHex("");
    pendingJoin.current = null;
    document.title = BASE_TITLE;
  }, [socket, rtc, p2p, resetRoleFlag, roomId, username]);

  // ── Derived display values ─────────────────────────────────────────────────
  const hasAnyKey  = p2pKeyActive || qKey.hasKey;
  const keyVersion = p2pKeyActive ? p2pKeyVersion : (qKey.keyInfo?.key_version ?? 0);

  // ── Room selector ──────────────────────────────────────────────────────────
  if (joinPhase !== "joined") {
    return (
      <>
        <RoomSelector
          status={joinPhase === "idle" ? socket.status : "connecting"}
          onJoin={handleJoin}
          onConnect={socket.connect}
        />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen-safe bg-background overflow-hidden">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80 backdrop-blur-sm z-10 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base font-bold text-primary flex-shrink-0">⚛</span>
          <Badge variant="outline" className="text-[10px] border-border text-slate-500 font-mono truncate max-w-[90px]">
            #{roomId}
          </Badge>
          <Badge variant="outline" className="text-[10px] border-border text-slate-500 hidden sm:flex">
            {username}
          </Badge>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {unreadCount > 0 && (
            <Badge className="text-[10px] bg-red-600 text-white border-0 animate-pulse">
              {unreadCount} new
            </Badge>
          )}

          <div className="flex items-center gap-1">
            <span className={
              socket.status === "connected"  ? "status-dot-green"  :
              socket.status === "connecting" ? "status-dot-yellow" : "status-dot-red"
            } />
            <span className="text-[10px] text-emerald-400 font-mono hidden sm:block">
              {memberCount} online
            </span>
          </div>

          {/* WebRTC connection dot */}
          {rtc.status !== "idle" && (
            <div className="flex items-center gap-1">
              <span className={
                rtc.status === "connected"  ? "status-dot-green"  :
                rtc.status === "error"      ? "status-dot-red"    : "status-dot-yellow"
              } />
              <span className="text-[10px] text-slate-500 hidden sm:block">p2p</span>
            </div>
          )}

          {hasAnyKey ? (
            <Badge className={`text-[10px] font-mono border ${
              p2pKeyActive
                ? "bg-violet-950/60 text-violet-300 border-violet-700/40"
                : "bg-emerald-950/60 text-emerald-400 border-emerald-800/40"
            }`}>
              {p2pKeyActive ? "🔗 P2P v" : "🔑 v"}{keyVersion}
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-amber-950/60 text-amber-400 border border-amber-800/40">
              ⚠ No key
            </Badge>
          )}

          <Button
            variant="ghost" size="sm" onClick={handleLeave}
            className="text-xs text-slate-500 hover:text-red-400 px-2"
          >
            ✕
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => { setActiveTab(v); if (v === "chat") setUnreadCount(0); }}
        className="flex flex-col flex-1 overflow-hidden min-h-0"
      >
        <TabsList className="grid grid-cols-4 w-full rounded-none border-b border-border bg-card/50 h-9 flex-shrink-0">
          <TabsTrigger value="chat" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary relative">
            💬 Chat
            {unreadCount > 0 && activeTab !== "chat" && (
              <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-red-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="p2p" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-violet-400 relative">
            🔗 P2P Key
            {rtc.status === "connected" && p2p.status !== "complete" && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            )}
          </TabsTrigger>
          <TabsTrigger value="quantum" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            ⚛ BB84
          </TabsTrigger>
          <TabsTrigger value="crypto" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            🔐 E2E
          </TabsTrigger>
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
            onSend={handleSend}
            onTyping={handleTypingEmit}
            onReact={handleReact}
            decrypt={decrypt}
            encrypt={aes.encrypt}
          />
        </TabsContent>

        <TabsContent value="p2p" className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden">
          <P2PKeyPanel
            role={rtc.role}
            rtcStatus={rtc.status}
            keyStatus={p2p.status}
            keyResult={p2p.keyResult}
            progress={p2p.progress}
            log={p2p.log}
            onInitiate={p2p.aliceInitiate}
            onReset={() => {
              p2p.reset();
              setP2pKeyActive(false);
              setP2pKeyHex("");
            }}
          />
        </TabsContent>

        <TabsContent value="quantum" className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden">
          <QuantumKeyPanel
            roomId={roomId}
            keyInfo={qKey.keyInfo}
            bb84Stats={qKey.bb84Stats}
            generating={qKey.generating}
            onGenerate={handleGenerate}
          />
        </TabsContent>

        <TabsContent value="crypto" className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden">
          <EncryptionDemo
            roomId={roomId}
            hasKey={hasAnyKey}
            decrypt={decrypt}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}