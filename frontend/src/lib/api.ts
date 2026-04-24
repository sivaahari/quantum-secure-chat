// frontend/src/lib/api.ts
/**
 * Typed REST API client for the Flask backend.
 * All functions use the Vite proxy → /api/* → http://localhost:5000/api/*
 */

import type { BB84Stats, KeyInfo, ChatMessage, RoomInfo } from "@/types";

const BACKEND = (import.meta.env.VITE_BACKEND_URL ?? "http://localhost:5000").replace(/\/$/, "");
const BASE = `${BACKEND}/api`;

// ─────────────────────────────────────────────────────────────────────────────
// Generic fetch wrapper
// ─────────────────────────────────────────────────────────────────────────────

async function apiFetch<T = Record<string, unknown>>(
  path:    string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data: Record<string, unknown>;
  try { data = await res.json(); }
  catch { throw new Error(`Server returned non-JSON response (HTTP ${res.status})`); }
  if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);
  return data as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────────

export interface HealthResponse {
  ok:           boolean;
  flask_status: string;
  ollama_ok:    boolean;
  ollama_model: string;
  ollama_models: string[];
}

export async function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health");
}

// ─────────────────────────────────────────────────────────────────────────────
// Rooms
// ─────────────────────────────────────────────────────────────────────────────

export async function createRoom(roomId: string): Promise<{ room: RoomInfo }> {
  return apiFetch("/rooms", {
    method: "POST",
    body:   JSON.stringify({ room_id: roomId }),
  });
}

export async function listRooms(): Promise<{ rooms: RoomInfo[] }> {
  return apiFetch("/rooms");
}

// ─────────────────────────────────────────────────────────────────────────────
// Quantum key
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateKeyResponse {
  ok:          boolean;
  room_id:     string;
  key_version: number;
  bb84:        BB84Stats;
  key_info:    KeyInfo;
}

export interface GenerateKeyParams {
  room_id:       string;
  num_qubits?:   number;
  noise_enabled?: boolean;
  depolar_prob?:  number;
  eavesdrop_prob?: number;
}

export async function generateQuantumKey(
  params: GenerateKeyParams
): Promise<GenerateKeyResponse> {
  return apiFetch<GenerateKeyResponse>("/quantum/generate-key", {
    method: "POST",
    body:   JSON.stringify(params),
  });
}

export async function fetchKeyInfo(
  roomId: string
): Promise<{ key_info: KeyInfo }> {
  return apiFetch(`/quantum/key-info/${roomId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchMessages(
  roomId: string,
  limit   = 50
): Promise<{ messages: ChatMessage[] }> {
  return apiFetch(`/messages/${roomId}?limit=${limit}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto demo
// ─────────────────────────────────────────────────────────────────────────────

export interface EncryptDemoResponse {
  ok:          boolean;
  plaintext:   string;
  encrypted:   { nonce_b64: string; ciphertext_b64: string; timestamp: number; key_version: number };
  key_version: number;
}

export async function encryptDemo(
  roomId:    string,
  plaintext: string
): Promise<EncryptDemoResponse> {
  return apiFetch<EncryptDemoResponse>("/crypto/encrypt-demo", {
    method: "POST",
    body:   JSON.stringify({ room_id: roomId, plaintext }),
  });
}

export async function decryptDemo(
  roomId:  string,
  payload: Record<string, unknown>
): Promise<{ plaintext: string }> {
  return apiFetch("/crypto/decrypt-demo", {
    method: "POST",
    body:   JSON.stringify({ room_id: roomId, payload }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM
// ─────────────────────────────────────────────────────────────────────────────

export interface LLMChatResponse {
  ok:         boolean;
  reply:      string;
  room_id:    string;
  model:      string;
  elapsed_ms: number;
}

export async function llmChat(
  message:    string,
  roomId:     string,
  temperature = 0.7
): Promise<LLMChatResponse> {
  return apiFetch<LLMChatResponse>("/llm/chat", {
    method: "POST",
    body:   JSON.stringify({ message, room_id: roomId, temperature }),
  });
}

export async function clearLLMHistory(roomId: string): Promise<void> {
  await apiFetch("/llm/clear-history", {
    method: "POST",
    body:   JSON.stringify({ room_id: roomId }),
  });
}

export async function fetchLLMModels(): Promise<{ models: string[] }> {
  return apiFetch("/llm/models");
}