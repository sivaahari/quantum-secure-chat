// frontend/src/types/index.ts
// ─── Shared type definitions ──────────────────────────────────────────────────

// ── Encrypted payload ──────────────────────────────────────────────────────────
export interface EncryptedPayload {
  nonce_b64:      string;
  ciphertext_b64: string;
  timestamp:      number;
  key_version:    number;
}

// ── BB84 ───────────────────────────────────────────────────────────────────────
export interface BlochVector {
  qubit_index: number;
  state:       string;
  basis:       string;
  x:           number;
  y:           number;
  z:           number;
}

export interface BB84Stats {
  num_qubits:          number;
  raw_key_length:      number;
  sifted_key_length:   number;
  final_key_length:    number;
  sifting_efficiency:  number;
  qber:                number;
  qber_safe:           boolean;
  noise_enabled:       boolean;
  final_key_hex:       string;
  key_hex_preview:     string;
  bloch_vectors:       BlochVector[];
  simulation_time_ms:  number;
  alice_sifted_sample: number[];
  bob_sifted_sample:   number[];
  alice_bases_sample:  number[];
  bob_bases_sample:    number[];
}

// ── Key record ─────────────────────────────────────────────────────────────────
export interface KeyInfo {
  key_version:    number;
  key_hex:        string;   // full 64-char hex — present on generate + history
  key_preview:    string;
  qber:           number;
  qber_safe:      boolean;
  generated_at:   number;
  messages_used:  number;
  noise_enabled:  boolean;
  sim_time_ms:    number;
  needs_refresh:  boolean;
}

// ── Reactions ──────────────────────────────────────────────────────────────────
// { "👍": ["Alice", "Bob"], "❤️": ["Charlie"] }
export type Reactions = Record<string, string[]>;

export const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "🔒", "⚡"] as const;
export type  ReactionEmoji = typeof ALLOWED_REACTIONS[number];

// ── Chat message ───────────────────────────────────────────────────────────────
export interface ChatMessage {
  message_id:          string;
  room_id:             string;
  sender:              string;
  encrypted_payload:   EncryptedPayload;
  key_version:         number;
  timestamp:           number;
  is_llm_reply:        boolean;
  reactions:           Reactions;
  key_refresh_needed?: boolean;
  // Derived client-side:
  decrypted_text?:     string;
  decryption_error?:   string;
}

// ── Room info ──────────────────────────────────────────────────────────────────
export interface RoomInfo {
  room_id:       string;
  created_at:    number;
  member_count:  number;
  message_count: number;
  has_key:       boolean;
  key_info:      KeyInfo | null;
}

// ── SocketIO event payloads ───────────────────────────────────────────────────
export interface RoomJoinedPayload {
  room_id:     string;
  username:    string;
  room_info:   RoomInfo;
  key_info:    KeyInfo | null;
  key_history: KeyInfo[];   // ← all known key versions with key_hex
  history:     ChatMessage[];
}

export interface NewMessagePayload extends ChatMessage {
  key_refresh_needed: boolean;
}

export interface KeyRefreshedPayload {
  room_id:     string;
  key_info:    KeyInfo;
  key_history: KeyInfo[];   // ← updated history including new key
  message:     string;
}

export interface TypingPayload {
  room_id:  string;
  username: string;
}

export interface UserJoinedPayload {
  room_id:  string;
  username: string;
  members:  number;
}

export interface UserLeftPayload {
  room_id:  string;
  username: string;
  members:  number;
}

export interface ReactionUpdatedPayload {
  room_id:    string;
  message_id: string;
  reactions:  Reactions;
}

// ── Connection state ───────────────────────────────────────────────────────────
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// ── API response ───────────────────────────────────────────────────────────────
export interface ApiResponse<T = Record<string, unknown>> {
  ok:     boolean;
  error?: string;
  [key: string]: unknown;
}