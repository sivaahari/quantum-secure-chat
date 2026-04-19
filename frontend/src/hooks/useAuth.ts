// frontend/src/hooks/useAuth.ts
/**
 * Auth state management.
 * Token stored in localStorage. Verified with /auth/me on app load.
 */

import { useState, useCallback, useEffect } from "react";

const BACKEND = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:5000";
const TOKEN_KEY = "qsc_token";

export interface AuthUser {
  user_id:     string;
  username:    string;
  role:        "admin" | "user";
  status:      "pending" | "approved" | "rejected";
  created_at:  number;
  approved_by: string | null;
}

export type AuthStatus = "loading" | "unauthenticated" | "pending" | "authenticated";

async function apiFetch(path: string, options: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res  = await fetch(`${BACKEND}${path}`, { headers, ...options });
  const data = await res.json();
  return { data, ok: res.ok };
}

export function useAuth() {
  const [user,   setUser]   = useState<AuthUser | null>(null);
  const [token,  setToken]  = useState<string>("");
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error,  setError]  = useState<string>("");

  // ── Restore session on mount ───────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) { setStatus("unauthenticated"); return; }

    apiFetch("/auth/me", {}, stored).then(({ data, ok }) => {
      if (ok && data.user) {
        setToken(stored);
        setUser(data.user);
        setStatus(data.user.status === "approved" ? "authenticated" : "pending");
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setStatus("unauthenticated");
      }
    });
  }, []);

  // ── Register ───────────────────────────────────────────────────────────────
  const register = useCallback(async (username: string, password: string) => {
    setError("");
    const { data, ok } = await apiFetch("/auth/register", {
      method: "POST",
      body:   JSON.stringify({ username, password }),
    });
    if (!ok) { setError(data.error ?? "Registration failed"); return false; }
    return { message: data.message, role: data.user.role };
  }, []);

  // ── Login ──────────────────────────────────────────────────────────────────
  const login = useCallback(async (username: string, password: string) => {
    setError("");
    const { data, ok } = await apiFetch("/auth/login", {
      method: "POST",
      body:   JSON.stringify({ username, password }),
    });
    if (!ok) { setError(data.error ?? "Login failed"); return false; }

    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
    setStatus(data.user.status === "approved" ? "authenticated" : "pending");
    return true;
  }, []);

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setStatus("unauthenticated");
    setError("");
  }, []);

  return { user, token, status, error, register, login, logout };
}