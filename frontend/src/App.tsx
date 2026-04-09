// frontend/src/App.tsx
import { useState, useCallback, useRef, useEffect } from "react";
import { Toaster, toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge }  from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { RoomSelector }    from "@/components/RoomSelector";
import { ChatWindow }      from "@/components/ChatWindow";
import { QuantumKeyPanel } from "@/components/QuantumKeyPanel";
import { EncryptionDemo }  from "@/components/EncryptionDemo";

import { useSocket }     from "@/hooks/useSocket";
import { useQuantumKey } from "@/hooks/useQuantumKey";
import { useAES }        from "@/hooks/useAES";

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

// ── Join state machine ─────────────────────────────────────────────────────────
type JoinPhase = "idle" | "connecting" | "joining" | "joined";

export default function App() {
  const [joinPhase,    setJoinPhase]    = useState<JoinPhase>("idle");
  const [roomId,       setRoomId]       = useState("");
  const [username,     setUsername]     = useState("");
  const [messages,     setMessages]     = useState<ChatMessage[]>([]);
  const [typingUsers,  setTypingUsers]  = useState<string[]>([]);
  const [activeTab,    setActiveTab]    = useState("chat");

  // ── (3) Online member count ─────────────────────────────────────────────────
  const [memberCount, setMemberCount] = useState(1);

  // ── (4) Unread message indicator ───────────────────────────────────────────
  const [unreadCount, setUnreadCount] = useState(0);
  const baseTitle = "Quantum-Secure Chat";

  // Update document title with unread count
  useEffect(() => {
    document.title = unreadCount > 0
      ? `(${unreadCount}) ${baseTitle}`
      : baseTitle;
  }, [unreadCount]);

  // Reset unread when tab regains focus
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) setUnreadCount(0);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Pending join for state-machine
  const pendingJoin = useRef<{ rid: string; uname: string } | null>(null);

  // ── Quantum key (1) key history map ────────────────────────────────────────
  const qKey = useQuantumKey(roomId);

  // ── AES — multi-version key map ────────────────────────────────────────────
  const aes = useAES(qKey.keyHexMap, qKey.keyInfo?.key_version ?? 0);

  const decrypt = useCallback(
    async (payload: EncryptedPayload) => aes.decrypt(payload),
    [aes]
  );

  // ── Socket callbacks ────────────────────────────────────────────────────────

  const handleRoomJoined = useCallback((payload: RoomJoinedPayload) => {
    console.log("[App] ✅ room_joined →", payload.room_id);

    // (1) Load ALL key versions so old messages decrypt
    if (payload.key_history && payload.key_history.length > 0) {
      qKey.importKeyHistory(payload.key_history);
    } else if (payload.key_info) {
      qKey.applyKeyFromJoin(payload.key_info, payload.key_info.key_hex);
    }

    setMessages(payload.history ?? []);
    setMemberCount(payload.room_info.member_count);
    setJoinPhase("joined");
    toast.success(`✅ Joined #${payload.room_id} as ${payload.username}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewMessage = useCallback((payload: NewMessagePayload) => {
    setMessages((prev) => {
      if (prev.some((m) => m.message_id === payload.message_id)) return prev;
      return [...prev, payload];
    });

    // (4) Increment unread count when tab is in background
    if (document.hidden && payload.sender !== username) {
      setUnreadCount((c) => c + 1);
    }

    if (payload.key_refresh_needed) {
      toast.info("🔑 Key refresh triggered…");
    }
  }, [username]);

  const handleKeyRefreshed = useCallback((payload: KeyRefreshedPayload) => {
    // (1) Apply new key AND keep history for old message decryption
    qKey.applyRefreshedKey(payload.key_info, payload.key_history);
    toast.success(payload.message, { duration: 4000 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTypingEvent = useCallback((payload: TypingPayload) => {
    if (payload.username === username) return;
    setTypingUsers((prev) =>
      prev.includes(payload.username) ? prev : [...prev, payload.username]
    );
    setTimeout(() => {
      setTypingUsers((prev) => prev.filter((u) => u !== payload.username));
    }, 2000);
  }, [username]);

  const handleUserJoined = useCallback((payload: UserJoinedPayload) => {
    setMemberCount(payload.members);              // (3) update member count
    toast.info(`👤 ${payload.username} joined #${payload.room_id}`);
  }, []);

  const handleUserLeft = useCallback((payload: UserLeftPayload) => {
    setMemberCount(payload.members);              // (3) update member count
    toast.info(`👤 ${payload.username} left`);
  }, []);

  // ── (5) Reactions ───────────────────────────────────────────────────────────
  const handleReactionUpdated = useCallback((payload: ReactionUpdatedPayload) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.message_id === payload.message_id
          ? { ...msg, reactions: payload.reactions }
          : msg
      )
    );
  }, []);

  // ── Socket hook ─────────────────────────────────────────────────────────────
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

  // ── Join state machine ──────────────────────────────────────────────────────
  useEffect(() => {
    if (joinPhase === "connecting" && socket.status === "connected") {
      const { rid, uname } = pendingJoin.current ?? {};
      if (rid && uname) {
        console.log("[App] Socket connected → emitting join_room:", rid, uname);
        pendingJoin.current = null;
        setJoinPhase("joining");
        socket.joinRoom(rid, uname);
      }
    }
  }, [socket.status, joinPhase, socket.joinRoom]);

  const handleJoin = useCallback(
    (rid: string, uname: string) => {
      if (joinPhase !== "idle") return;
      console.log("[App] handleJoin →", rid, uname);
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

  // ── Send message ────────────────────────────────────────────────────────────
  const handleSend = useCallback(
    (plaintext: string, encryptedPayload: EncryptedPayload) => {
      socket.sendMessage(roomId, username, encryptedPayload, plaintext);
    },
    [socket, roomId, username]
  );

  // ── Typing ──────────────────────────────────────────────────────────────────
  const handleTypingEmit = useCallback(() => {
    socket.sendTyping(roomId, username);
  }, [socket, roomId, username]);

  // ── (5) React to message ────────────────────────────────────────────────────
  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      socket.sendReaction(roomId, messageId, username, emoji);
    },
    [socket, roomId, username]
  );

  // ── Generate quantum key ────────────────────────────────────────────────────
  const handleGenerate = useCallback(
    async (opts: Parameters<typeof qKey.generate>[0]) => {
      await qKey.generate(opts);
      setActiveTab("chat");
    },
    [qKey]
  );

  // ── Leave room ──────────────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    socket.leaveRoom(roomId, username);
    socket.disconnect();
    setJoinPhase("idle");
    setMessages([]);
    setRoomId("");
    setUsername("");
    setMemberCount(1);
    setUnreadCount(0);
    pendingJoin.current = null;
    document.title = baseTitle;
  }, [socket, roomId, username]);

  // ── Room selector screen ────────────────────────────────────────────────────
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

  // ── Main chat UI ─────────────────────────────────────────────────────────────
  return (
    // h-screen-safe = 100dvh — shrinks when mobile keyboard appears
    <div className="flex flex-col h-screen-safe bg-background overflow-hidden">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80 backdrop-blur-sm z-10 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base font-bold text-primary flex-shrink-0">⚛ Quantum</span>
          <Badge
            variant="outline"
            className="text-[10px] border-border text-slate-500 font-mono truncate max-w-[100px]"
          >
            #{roomId}
          </Badge>
          <Badge variant="outline" className="text-[10px] border-border text-slate-500 hidden sm:flex">
            {username}
          </Badge>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* (4) Unread badge */}
          {unreadCount > 0 && (
            <Badge className="text-[10px] bg-red-600 text-white border-0 animate-pulse">
              {unreadCount} new
            </Badge>
          )}

          {/* Connection dot */}
          <div className="flex items-center gap-1">
            <span className={
              socket.status === "connected"  ? "status-dot-green"  :
              socket.status === "connecting" ? "status-dot-yellow" :
              "status-dot-red"
            } />
          </div>

          {/* Key status */}
          {qKey.hasKey ? (
            <Badge className="text-[10px] font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
              🔑 v{qKey.keyInfo?.key_version}
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-amber-950/60 text-amber-400 border border-amber-800/40">
              ⚠ No key
            </Badge>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLeave}
            className="text-xs text-slate-500 hover:text-red-400 px-2"
          >
            ✕
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v);
          if (v === "chat") setUnreadCount(0); // (4) clear unread on chat focus
        }}
        className="flex flex-col flex-1 overflow-hidden min-h-0"
      >
        <TabsList className="grid grid-cols-3 w-full rounded-none border-b border-border bg-card/50 h-9 flex-shrink-0">
          <TabsTrigger
            value="chat"
            className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary relative"
          >
            💬 Chat
            {/* (4) Dot indicator on tab when there are unread messages */}
            {unreadCount > 0 && activeTab !== "chat" && (
              <span className="absolute top-1 right-3 w-1.5 h-1.5 rounded-full bg-red-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="quantum" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            ⚛ Quantum Key
          </TabsTrigger>
          <TabsTrigger value="crypto" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            🔐 E2E Demo
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="chat"
          className="flex-1 overflow-hidden m-0 p-0 data-[state=inactive]:hidden min-h-0"
        >
          <ChatWindow
            roomId={roomId}
            username={username}
            messages={messages}
            typingUsers={typingUsers}
            memberCount={memberCount}
            hasKey={qKey.hasKey}
            keyVersion={qKey.keyInfo?.key_version ?? 0}
            onSend={handleSend}
            onTyping={handleTypingEmit}
            onReact={handleReact}
            decrypt={decrypt}
            encrypt={aes.encrypt}
          />
        </TabsContent>

        <TabsContent
          value="quantum"
          className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden"
        >
          <QuantumKeyPanel
            roomId={roomId}
            keyInfo={qKey.keyInfo}
            bb84Stats={qKey.bb84Stats}
            generating={qKey.generating}
            onGenerate={handleGenerate}
          />
        </TabsContent>

        <TabsContent
          value="crypto"
          className="flex-1 overflow-auto m-0 p-0 data-[state=inactive]:hidden"
        >
          <EncryptionDemo
            roomId={roomId}
            hasKey={qKey.hasKey}
            decrypt={decrypt}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}