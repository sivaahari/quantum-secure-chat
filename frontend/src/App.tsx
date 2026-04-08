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
  EncryptedPayload,
} from "@/types";

// ── Join state machine ─────────────────────────────────────────────────────
type JoinPhase =
  | "idle"          // not started
  | "connecting"    // socket.connect() called, waiting for "connected"
  | "joining"       // emit join_room, waiting for room_joined event
  | "joined";       // room_joined received, show main UI

export default function App() {
  const [joinPhase,   setJoinPhase]   = useState<JoinPhase>("idle");
  const [roomId,      setRoomId]      = useState("");
  const [username,    setUsername]    = useState("");
  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [activeTab,   setActiveTab]   = useState("chat");

  // Store intended room/user so the useEffect can access them after connect
  const intendedRoom = useRef("");
  const intendedUser = useRef("");

  // ── Quantum key ──────────────────────────────────────────────────────────
  const qKey = useQuantumKey(roomId);

  // ── AES cipher ───────────────────────────────────────────────────────────
  const aes = useAES(qKey.keyHex, qKey.keyInfo?.key_version ?? 0);

  const decrypt = useCallback(
    async (payload: EncryptedPayload) => aes.decrypt(payload),
    [aes]
  );

  // ── Socket callbacks ──────────────────────────────────────────────────────
  const handleRoomJoined = useCallback((payload: RoomJoinedPayload) => {
    console.log("[App] ✅ room_joined received →", payload.room_id);

    if (payload.key_info) {
      // key_hex is present on the key_info object returned by the server
      const keyHex = (payload.key_info as typeof payload.key_info & { key_hex?: string }).key_hex;
      qKey.applyKeyFromJoin(payload.key_info, keyHex);
    }

    setMessages(payload.history ?? []);
    setJoinPhase("joined");
    toast.success(`✅ Joined #${payload.room_id} as ${payload.username}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewMessage = useCallback((payload: NewMessagePayload) => {
    setMessages((prev) => {
      if (prev.some((m) => m.message_id === payload.message_id)) return prev;
      return [...prev, payload];
    });
    if (payload.key_refresh_needed) {
      toast.info("🔑 Key refresh triggered…");
    }
  }, []);

  const handleKeyRefreshed = useCallback((payload: KeyRefreshedPayload) => {
    qKey.applyRefreshedKey(payload.key_info);
    toast.success(payload.message, { duration: 4000 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTypingEvent = useCallback((payload: TypingPayload) => {
    setTypingUsers((prev) =>
      prev.includes(payload.username) ? prev : [...prev, payload.username]
    );
    setTimeout(() => {
      setTypingUsers((prev) => prev.filter((u) => u !== payload.username));
    }, 2000);
  }, []);

  // ── Socket hook ───────────────────────────────────────────────────────────
  const socket = useSocket({
    onRoomJoined:   handleRoomJoined,
    onNewMessage:   handleNewMessage,
    onKeyRefreshed: handleKeyRefreshed,
    onTyping:       handleTypingEvent,
    onUserJoined:   (p) => toast.info(`👤 ${p.username} joined #${p.room_id}`),
    onUserLeft:     (p) => toast.info(`👤 ${p.username} left`),
    onError:        (p) => toast.error(`⚠ ${p.message}`),
  });

  // ── Join state machine effect ─────────────────────────────────────────────
  // When socket reaches "connected" and we're in "connecting" phase,
  // emit join_room immediately.
  useEffect(() => {
    if (joinPhase === "connecting" && socket.status === "connected") {
      const rid   = intendedRoom.current;
      const uname = intendedUser.current;
      if (rid && uname) {
        console.log("[App] Socket connected → emitting join_room:", rid, uname);
        setJoinPhase("joining");
        socket.joinRoom(rid, uname);
      }
    }
  }, [socket.status, joinPhase, socket.joinRoom]);

  // ── Join handler (called by RoomSelector) ──────────────────────────────────
  const handleJoin = useCallback(
    (rid: string, uname: string) => {
      // Prevent double-join
      if (joinPhase !== "idle") {
        console.log("[App] Join already in progress, ignoring duplicate call");
        return;
      }

      console.log("[App] Starting join →", rid, uname);
      setRoomId(rid);
      setUsername(uname);
      intendedRoom.current = rid;
      intendedUser.current = uname;

      if (socket.status === "connected") {
        // Already connected — emit immediately
        console.log("[App] Already connected, emitting join_room directly");
        setJoinPhase("joining");
        socket.joinRoom(rid, uname);
      } else {
        // Need to connect first — useEffect above will emit join after connect
        setJoinPhase("connecting");
        socket.connect();
      }
    },
    [joinPhase, socket]
  );

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(
    (plaintext: string, encryptedPayload: EncryptedPayload) => {
      socket.sendMessage(roomId, username, encryptedPayload, plaintext);
    },
    [socket, roomId, username]
  );

  // ── Typing ────────────────────────────────────────────────────────────────
  const handleTypingEmit = useCallback(() => {
    socket.sendTyping(roomId, username);
  }, [socket, roomId, username]);

  // ── Generate quantum key ───────────────────────────────────────────────────
  const handleGenerate = useCallback(
    async (opts: Parameters<typeof qKey.generate>[0]) => {
      await qKey.generate(opts);
      setActiveTab("chat");
    },
    [qKey]
  );

  // ── Leave room ─────────────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    socket.leaveRoom(roomId, username);
    socket.disconnect();
    setJoinPhase("idle");
    setMessages([]);
    setRoomId("");
    setUsername("");
    intendedRoom.current = "";
    intendedUser.current = "";
  }, [socket, roomId, username]);

  // ── Render: Room selector ──────────────────────────────────────────────────
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

  // ── Render: Main chat UI ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <Toaster richColors position="top-right" />

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80 backdrop-blur-sm z-10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-primary">⚛ Quantum-LLM</span>
          <Badge variant="outline" className="text-[10px] border-border text-slate-500 font-mono">
            #{roomId}
          </Badge>
          <Badge variant="outline" className="text-[10px] border-border text-slate-500">
            {username}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          {/* Connection dot */}
          <div className="flex items-center gap-1.5">
            <span className={
              socket.status === "connected"  ? "status-dot-green"  :
              socket.status === "connecting" ? "status-dot-yellow" :
              "status-dot-red"
            } />
            <span className="text-[10px] text-slate-500 hidden sm:block">
              {socket.status}
            </span>
          </div>

          {/* Key status */}
          {qKey.hasKey ? (
            <Badge className="text-[10px] font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
              🔑 Key v{qKey.keyInfo?.key_version} · AES-256
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-amber-950/60 text-amber-400 border border-amber-800/40">
              ⚠ No key — go to ⚛ tab
            </Badge>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLeave}
            className="text-xs text-slate-500 hover:text-red-400"
          >
            ✕ Leave
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col flex-1 overflow-hidden"
      >
        <TabsList className="grid grid-cols-3 w-full rounded-none border-b border-border bg-card/50 h-9 flex-shrink-0">
          <TabsTrigger value="chat" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            💬 Chat
          </TabsTrigger>
          <TabsTrigger value="quantum" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            ⚛ Quantum Key
          </TabsTrigger>
          <TabsTrigger value="crypto" className="text-xs rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            🔐 E2E Demo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 overflow-hidden m-0 p-0 data-[state=inactive]:hidden">
          <ChatWindow
            roomId={roomId}
            username={username}
            messages={messages}
            typingUsers={typingUsers}
            hasKey={qKey.hasKey}
            keyVersion={qKey.keyInfo?.key_version ?? 0}
            onSend={handleSend}
            onTyping={handleTypingEmit}
            decrypt={decrypt}
            encrypt={aes.encrypt}
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
            hasKey={qKey.hasKey}
            decrypt={decrypt}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}