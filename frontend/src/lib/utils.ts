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