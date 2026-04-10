// frontend/src/components/ChatWindow.tsx
import {
  useRef, useState, useEffect, useCallback, KeyboardEvent,
} from "react";
import { ScrollArea }    from "@/components/ui/scroll-area";
import { Input }         from "@/components/ui/input";
import { Button }        from "@/components/ui/button";
import { Badge }         from "@/components/ui/badge";
import { MessageBubble } from "@/components/MessageBubble";
import type { ChatMessage, EncryptedPayload } from "@/types";

interface ChatWindowProps {
  roomId:      string;
  username:    string;
  messages:    ChatMessage[];
  typingUsers: string[];
  memberCount: number;                 // ← NEW: online member count
  hasKey:      boolean;
  keyVersion:  number;
  onSend:      (plaintext: string, encrypted: EncryptedPayload) => void;
  onTyping:    () => void;
  onReact:     (messageId: string, emoji: string) => void;  // ← NEW
  decrypt:     (payload: EncryptedPayload) => Promise<string>;
  encrypt:     (text: string) => Promise<EncryptedPayload | null>;
}

export function ChatWindow({
  roomId, username, messages, typingUsers, memberCount,
  hasKey, keyVersion, onSend, onTyping, onReact,
  decrypt, encrypt,
}: ChatWindowProps) {
  const [input,   setInput]   = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef             = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef              = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Focus input on mount (desktop)
  useEffect(() => {
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    if (!isMobile) inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !hasKey || sending) return;
    setSending(true);
    try {
      const payload = await encrypt(text);
      if (!payload) return;
      onSend(text, payload);
      setInput("");
    } finally {
      setSending(false);
    }
  }, [input, hasKey, sending, encrypt, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (v: string) => {
    setInput(v);
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
    }
    typingTimer.current = setTimeout(onTyping, 300);
  };

  return (
    // h-full ensures we fill whatever container wraps us.
    // On mobile, the parent uses h-screen-safe (100dvh) which shrinks
    // when the keyboard appears — so this layout stays visible.
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/50 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-slate-200 truncate">
            # {roomId}
          </span>
          <Badge
            variant="outline"
            className="font-mono text-[10px] px-1.5 py-0 border-primary/40 text-primary flex-shrink-0"
          >
            AES-256-GCM · v{keyVersion}
          </Badge>
        </div>

        {/* Member count + message count */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1">
            <span className="status-dot-green" />
            <span className="text-xs text-emerald-400 font-mono">
              {memberCount} online
            </span>
          </div>
          <span className="text-xs text-slate-500 hidden sm:block">
            {messages.length} msg{messages.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Message list ── */}
      {/* flex-1 + min-h-0 is the CSS trick that makes overflow work inside a flex column */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 scroll-smooth">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-slate-500">
            <div className="text-4xl opacity-30">🔐</div>
            <p className="text-sm text-center px-4">
              {hasKey
                ? "No messages yet — say hello!"
                : "Go to the ⚛ Quantum Key tab to generate a key first."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.message_id}
                message={msg}
                isMine={msg.sender === username}
                username={username}
                decrypt={decrypt}
                onReact={onReact}
              />
            ))}
          </div>
        )}

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <div className="flex items-center gap-2 mt-3 px-1">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <span className="text-xs text-slate-500">
              {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing…
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ──
          input-safe-area adds env(safe-area-inset-bottom) padding so this
          area is never hidden behind the iPhone home indicator or Android
          navigation bar — even when the keyboard is open.
      ── */}
      <div className="px-4 pt-3 pb-3 border-t border-border bg-card/30 flex-shrink-0 input-safe-area">
        {!hasKey && (
          <div className="mb-2 px-3 py-1.5 rounded-lg bg-amber-950/40 border border-amber-700/40">
            <p className="text-xs text-amber-400">
              ⚠ No quantum key — go to the <strong>⚛ Quantum Key</strong> tab.
            </p>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasKey ? "Type a message… (Enter to send)" : "Generate a key first…"}
            disabled={!hasKey || sending}
            className="flex-1 bg-secondary/50 border-border focus:border-primary/60 text-sm"
            // Prevent iOS zoom on focus (font-size must be ≥ 16px to avoid zoom)
            style={{ fontSize: "16px" }}
          />
          <Button
            onClick={handleSend}
            disabled={!hasKey || !input.trim() || sending}
            size="sm"
            className="px-4 bg-primary text-primary-foreground hover:bg-primary/90 flex-shrink-0"
          >
            {sending ? "…" : "Send 🔒"}
          </Button>
        </div>
        <p className="text-[10px] text-slate-600 mt-1.5">
          Click message to toggle view · Right-click to react
        </p>
      </div>
    </div>
  );
}