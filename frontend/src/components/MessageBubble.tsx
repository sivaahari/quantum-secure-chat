// frontend/src/components/MessageBubble.tsx
import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import type { ChatMessage, Reactions, ReactionEmoji } from "@/types";
import { ALLOWED_REACTIONS } from "@/types";
import { formatTime } from "@/lib/utils";

interface MessageBubbleProps {
  message:   ChatMessage;
  isMine:    boolean;
  username:  string;
  decrypt:   (payload: ChatMessage["encrypted_payload"]) => Promise<string>;
  onReact:   (messageId: string, emoji: string) => void;
}

export function MessageBubble({
  message, isMine, username, decrypt, onReact,
}: MessageBubbleProps) {
  const [text,         setText]         = useState<string>(message.decrypted_text ?? "");
  const [loading,      setLoading]      = useState(!message.decrypted_text);
  const [showRaw,      setShowRaw]      = useState(false);
  const [showPicker,   setShowPicker]   = useState(false);
  const [reactions,    setReactions]    = useState<Reactions>(message.reactions ?? {});

  // Keep reactions in sync when parent updates the message
  useEffect(() => {
    setReactions(message.reactions ?? {});
  }, [message.reactions]);

  // Decrypt on mount
  useEffect(() => {
    if (message.decrypted_text) {
      setText(message.decrypted_text);
      setLoading(false);
      return;
    }
    setLoading(true);
    decrypt(message.encrypted_payload)
      .then((t) => { setText(t); setLoading(false); })
      .catch(() => { setText("⚠ Could not decrypt"); setLoading(false); });
  }, [message.message_id]); // only re-run if the message itself changes

  const handleBubbleClick = useCallback(() => {
    setShowRaw((v) => !v);
    setShowPicker(false);
  }, []);

  const handleLongPress = useCallback(() => {
    setShowPicker((v) => !v);
  }, []);

  const handleReact = useCallback(
    (emoji: string) => {
      onReact(message.message_id, emoji);
      setShowPicker(false);
    },
    [message.message_id, onReact]
  );

  // Total reaction count across all emojis
  const totalReactions = Object.values(reactions).reduce(
    (sum, users) => sum + users.length,
    0
  );

  const bubbleClass = isMine ? "msg-mine" : "msg-other";

  const senderColor = isMine ? "text-primary" : "text-slate-300";

  return (
    <div
      className={`flex flex-col gap-1 max-w-[80%] ${isMine ? "items-end ml-auto" : "items-start"}`}
    >
      {/* Sender + time */}
      <div className={`flex items-center gap-2 px-1 ${isMine ? "flex-row-reverse" : ""}`}>
        <span className={`text-xs font-medium ${senderColor}`}>
          {message.sender}
        </span>
        <span className="text-xs text-slate-500">
          {formatTime(message.timestamp)}
        </span>
      </div>

      {/* Bubble */}
      <div className="relative group">
        <div
          className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed cursor-pointer select-none transition-all ${bubbleClass}`}
          onClick={handleBubbleClick}
          onContextMenu={(e) => { e.preventDefault(); handleLongPress(); }}
          title="Click: toggle encrypted view  |  Right-click: react"
        >
          {loading ? (
            <span className="text-slate-400 animate-pulse text-xs">Decrypting…</span>
          ) : showRaw ? (
            <div className="font-mono text-[10px] text-slate-400 break-all space-y-1 max-w-xs">
              <div>
                <span className="text-slate-500">nonce: </span>
                <span className="text-amber-400">{message.encrypted_payload.nonce_b64}</span>
              </div>
              <div>
                <span className="text-slate-500">cipher: </span>
                <span className="text-emerald-400">
                  {message.encrypted_payload.ciphertext_b64.slice(0, 40)}…
                </span>
              </div>
              <div>
                <span className="text-slate-500">key v</span>
                <span className="text-primary">{message.encrypted_payload.key_version}</span>
              </div>
            </div>
          ) : (
            <span className="text-slate-100">{text}</span>
          )}
        </div>

        {/* ── Reaction picker — appears on right-click / long-press ── */}
        {showPicker && (
          <div
            className={`absolute z-20 flex gap-1 p-1.5 rounded-xl bg-slate-800 border border-border shadow-xl
              ${isMine ? "right-0" : "left-0"} -top-10`}
          >
            {ALLOWED_REACTIONS.map((emoji) => {
              const myReaction = reactions[emoji]?.includes(username);
              return (
                <button
                  key={emoji}
                  onClick={() => handleReact(emoji)}
                  className={`text-lg w-8 h-8 rounded-lg flex items-center justify-center
                    transition-all hover:scale-125 active:scale-95
                    ${myReaction
                      ? "bg-primary/30 ring-1 ring-primary/50"
                      : "hover:bg-slate-700"
                    }`}
                  title={emoji}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Reaction display ── */}
      {totalReactions > 0 && (
        <div className={`flex flex-wrap gap-1 px-1 ${isMine ? "justify-end" : "justify-start"}`}>
          {Object.entries(reactions).map(([emoji, users]) => {
            if (users.length === 0) return null;
            const iMineReaction = users.includes(username);
            return (
              <button
                key={emoji}
                onClick={() => handleReact(emoji)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                  border transition-all hover:scale-105 active:scale-95
                  ${iMineReaction
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "bg-secondary border-border text-slate-400 hover:border-slate-500"
                  }`}
                title={`${users.join(", ")} reacted`}
              >
                <span>{emoji}</span>
                <span className="font-mono">{users.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Meta badges ── */}
      <div className={`flex items-center gap-1.5 px-1 ${isMine ? "flex-row-reverse" : ""}`}>
        <Badge
          variant="outline"
          className="text-[9px] px-1.5 py-0 border-slate-700 text-slate-500 font-mono"
        >
          🔑 v{message.key_version}
        </Badge>
        {message.key_refresh_needed && (
          <Badge
            variant="outline"
            className="text-[9px] px-1.5 py-0 border-amber-700 text-amber-400"
          >
            ↻ key refresh
          </Badge>
        )}
        <span className="text-[9px] text-slate-600">
          {showRaw ? "🔒 encrypted" : "🔓 decrypted"} · right-click to react
        </span>
      </div>
    </div>
  );
}