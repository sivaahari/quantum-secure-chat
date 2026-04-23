// frontend/src/lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn/ui required utility
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Format a Unix timestamp to HH:MM:SS */
export function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Shorten a hex key for display: show first 8 and last 4 chars */
export function shortenHex(hex: string, head = 8, tail = 4): string {
  if (!hex || hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** Convert hex string → Uint8Array */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Convert Uint8Array → hex string */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** base64 string → Uint8Array */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Uint8Array → base64 string */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

/**
 * Derive a human-readable "safety number" from a 64-char key hex.
 * Takes the first 20 hex chars (10 bytes) and formats them as
 * five groups of 4 uppercase chars: "A3F2 B891 C45D E720 1F3A"
 * Both peers should compare this out-of-band to confirm no MITM.
 */
export function safetyNumber(keyHex: string): string {
  if (!keyHex || keyHex.length < 20) return "";
  const s = keyHex.slice(0, 20).toUpperCase();
  return [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20)].join(" ");
}

/** Format QBER as percentage string with color class */
export function qberStatus(qber: number): { text: string; cls: string } {
  const pct = (qber * 100).toFixed(2);
  if (qber < 0.05)  return { text: `${pct}% ✓`,  cls: "text-emerald-400" };
  if (qber < 0.11)  return { text: `${pct}% ⚠`,  cls: "text-amber-400"   };
  return              { text: `${pct}% ✗`,  cls: "text-red-400"     };
}

/** Generate a random room-friendly ID */
export function randomRoomId(): string {
  const words = ["alpha", "beta", "gamma", "delta", "sigma", "omega", "zeta"];
  const word  = words[Math.floor(Math.random() * words.length)];
  const num   = Math.floor(Math.random() * 900) + 100;
  return `${word}-${num}`;
}

/** Generate a random username */
export function randomUsername(): string {
  const names = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank"];
  return names[Math.floor(Math.random() * names.length)];
}