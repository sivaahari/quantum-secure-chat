// frontend/src/components/AuthPage.tsx
import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input }  from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label }  from "@/components/ui/label";
import { Badge }  from "@/components/ui/badge";

interface AuthPageProps {
  onRegister: (username: string, password: string) => Promise<any>;
  onLogin:    (username: string, password: string) => Promise<any>;
  error:      string;
}

export function AuthPage({ onRegister, onLogin, error }: AuthPageProps) {
  const [mode,     setMode]     = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [notice,   setNotice]   = useState("");

  const handleSubmit = useCallback(async () => {
    if (!username.trim() || !password.trim()) return;

    if (mode === "register") {
      if (password !== confirm) {
        setNotice("Passwords do not match");
        return;
      }
      if (password.length < 6) {
        setNotice("Password must be at least 6 characters");
        return;
      }
    }

    setLoading(true);
    setNotice("");

    try {
      if (mode === "login") {
        await onLogin(username.trim(), password);
      } else {
        const result = await onRegister(username.trim(), password);
        if (result) {
          setNotice(result.message);
          setMode("login");
          setPassword("");
          setConfirm("");
        }
      }
    } finally {
      setLoading(false);
    }
  }, [mode, username, password, confirm, onLogin, onRegister]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md bg-card border-border quantum-glow-strong">
        <CardHeader className="text-center pb-4">
          <div className="text-5xl mb-3">⚛🔐</div>
          <CardTitle className="text-xl text-slate-100">
            Quantum-Secure Chat
          </CardTitle>
          <p className="text-xs text-slate-400 mt-1">
            BB84 QKD · AES-256-GCM · End-to-End Encrypted
          </p>

          {/* Mode switcher */}
          <div className="flex gap-2 justify-center mt-4">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setNotice(""); }}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Error from parent */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-950/40 border border-red-700/40">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Success / info notice */}
          {notice && (
            <div className="px-3 py-2 rounded-lg bg-emerald-950/40 border border-emerald-700/40">
              <p className="text-xs text-emerald-400">{notice}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs text-slate-400">Username</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="alice"
              className="bg-secondary/50 border-border"
              disabled={loading}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              autoComplete="username"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-slate-400">Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="bg-secondary/50 border-border"
              disabled={loading}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {mode === "register" && (
            <div className="space-y-2">
              <Label className="text-xs text-slate-400">Confirm Password</Label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className="bg-secondary/50 border-border"
                disabled={loading}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={loading || !username.trim() || !password.trim()}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {loading
              ? "Please wait…"
              : mode === "login"
              ? "🔐 Sign In"
              : "🚀 Create Account"}
          </Button>

          {/* Info boxes */}
          <div className="pt-2 space-y-2">
            {mode === "register" && (
              <div className="px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-[10px] text-slate-400">
                  <strong className="text-primary">First registered user</strong> becomes admin automatically.
                  All subsequent users require admin approval before logging in.
                </p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 text-center text-[9px] text-slate-600">
              <div>⚛ BB84<br/>quantum keys</div>
              <div>🔒 AES-256<br/>encryption</div>
              <div>🔗 WebRTC<br/>P2P mode</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}