// frontend/src/components/MessageBubble.tsx
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { ChatMessage } from "@/types";
import { formatTime, shortenHex } from "@/lib/utils";

interface MessageBubbleProps {
  message:    ChatMessage;
  isMine:     boolean;
  decrypt:    (payload: ChatMessage["encrypted_payload"]) => Promise<string>;
}

export function MessageBubble({ message, isMine, decrypt }: MessageBubbleProps) {
  const [text,    setText]    = useState<string>(message.decrypted_text ?? "");
  const [loading, setLoading] = useState(!message.decrypted_text);
  const [showRaw, setShowRaw] = useState(false);

  // Decrypt on mount (or when message changes)
  useEffect(() => {
    // If LLM reply, server sends plaintext directly
    if (message.llm_plaintext) {
      setText(message.llm_plaintext);
      setLoading(false);
      return;
    }
    if (message.decrypted_text) {
      setText(message.decrypted_text);
      setLoading(false);
      return;
    }

    setLoading(true);
    decrypt(message.encrypted_payload)
      .then((t) => { setText(t); setLoading(false); })
      .catch(() => { setText("⚠ Could not decrypt"); setLoading(false); });
  }, [message, decrypt]);

  const bubbleClass = message.is_llm_reply
    ? "msg-llm"
    : isMine
    ? "msg-mine"
    : "msg-other";

  const senderColor = message.is_llm_reply
    ? "text-violet-400"
    : isMine
    ? "text-primary"
    : "text-slate-300";

  return (
    <div className={`flex flex-col gap-1 ${isMine ? "items-end" : "items-start"} max-w-[80%] ${isMine ? "ml-auto" : ""}`}>
      {/* Sender + time */}
      <div className={`flex items-center gap-2 px-1 ${isMine ? "flex-row-reverse" : ""}`}>
        <span className={`text-xs font-medium ${senderColor}`}>
          {message.sender}
        </span>
        <span className="text-xs text-slate-500">
          {formatTime(message.timestamp)}
        </span>
        {message.is_llm_reply && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-violet-700 text-violet-400">
            LLM
          </Badge>
        )}
      </div>

      {/* Message bubble */}
      <div
        className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed transition-all ${bubbleClass} cursor-pointer`}
        onClick={() => setShowRaw(!showRaw)}
        title="Click to toggle encrypted view"
      >
        {loading ? (
          <span className="text-slate-400 animate-pulse">Decrypting…</span>
        ) : showRaw ? (
          /* Raw encrypted view */
          <div className="font-mono text-[10px] text-slate-400 break-all space-y-1">
            <div>
              <span className="text-slate-500">nonce: </span>
              <span className="text-amber-400">
                {message.encrypted_payload.nonce_b64}
              </span>
            </div>
            <div>
              <span className="text-slate-500">cipher: </span>
              <span className="text-emerald-400 break-all">
                {message.encrypted_payload.ciphertext_b64.slice(0, 48)}…
              </span>
            </div>
            <div>
              <span className="text-slate-500">key v</span>
              <span className="text-primary">
                {message.encrypted_payload.key_version}
              </span>
            </div>
          </div>
        ) : (
          <span className="text-slate-100">{text}</span>
        )}
      </div>

      {/* Key version badge */}
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
          {showRaw ? "🔒 encrypted" : "🔓 decrypted"} — click to toggle
        </span>
      </div>
    </div>
  );
}