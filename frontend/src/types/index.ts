// frontend/src/types/index.ts
// ─── Shared type definitions ──────────────────────────────────────────────────

// ── Encrypted payload (mirrors Python EncryptedPayload dataclass) ─────────────
export interface EncryptedPayload {
  nonce_b64:      string;   // base64-encoded 12-byte nonce
  ciphertext_b64: string;   // base64-encoded ciphertext + 16-byte GCM tag
  timestamp:      number;   // Unix epoch float
  key_version:    number;   // which BB84 key version encrypted this
}

// ── BB84 result (mirrors Python BB84Result.to_dict()) ─────────────────────────
export interface BlochVector {
  qubit_index: number;
  state:       string;   // "|0⟩" | "|1⟩" | "|+⟩" | "|−⟩"
  basis:       string;   // "rectilinear" | "diagonal"
  x:           number;
  y:           number;
  z:           number;
}

export interface BB84Stats {
  num_qubits:         number;
  raw_key_length:     number;
  sifted_key_length:  number;
  final_key_length:   number;
  sifting_efficiency: number;
  qber:               number;
  qber_safe:          boolean;
  noise_enabled:      boolean;
  final_key_hex:      string;
  key_hex_preview:    string;
  bloch_vectors:      BlochVector[];
  simulation_time_ms: number;
  alice_sifted_sample: number[];
  bob_sifted_sample:   number[];
  alice_bases_sample:  number[];
  bob_bases_sample:    number[];
}

// ── Key record (mirrors Python KeyRecord.to_dict()) ───────────────────────────
export interface KeyInfo {
  key_version:    number;
  key_hex:        string;   // FULL hex — available on generate; preview-only from events
  key_preview:    string;
  qber:           number;
  qber_safe:      boolean;
  generated_at:   number;
  messages_used:  number;
  noise_enabled:  boolean;
  sim_time_ms:    number;
  needs_refresh:  boolean;
}

// ── Chat message (mirrors Python StoredMessage.to_dict()) ─────────────────────
export interface ChatMessage {
  message_id:        string;
  room_id:           string;
  sender:            string;
  encrypted_payload: EncryptedPayload;
  key_version:       number;
  timestamp:         number;
  is_llm_reply:      boolean;
  key_refresh_needed?: boolean;
  llm_plaintext?:    string;   // only set for LLM replies from server
  // Derived client-side after decryption:
  decrypted_text?:   string;
  decryption_error?: string;
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
  room_id:   string;
  username:  string;
  room_info: RoomInfo;
  key_info:  KeyInfo | null;
  history:   ChatMessage[];
}

export interface NewMessagePayload extends ChatMessage {
  key_refresh_needed: boolean;
}

export interface KeyRefreshedPayload {
  room_id:   string;
  key_info:  KeyInfo;
  message:   string;
}

export interface TypingPayload {
  room_id:   string;
  username:  string;
}

export interface UserJoinedPayload {
  room_id:  string;
  username: string;
  members:  number;
}

// ── Connection state ───────────────────────────────────────────────────────────
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// ── API response helpers ───────────────────────────────────────────────────────
export interface ApiResponse<T = Record<string, unknown>> {
  ok:    boolean;
  error?: string;
  [key: string]: unknown;
}