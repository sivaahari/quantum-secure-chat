// frontend/src/components/RoomSelector.tsx
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input }  from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label }  from "@/components/ui/label";
import { randomRoomId, randomUsername } from "@/lib/utils";
import type { ConnectionStatus } from "@/types";

interface RoomSelectorProps {
  status:    ConnectionStatus;
  onJoin:    (roomId: string, username: string) => void;
  onConnect: () => void;
}

export function RoomSelector({ status, onJoin, onConnect }: RoomSelectorProps) {
  const [roomId,   setRoomId]   = useState(randomRoomId());
  const [username, setUsername] = useState(randomUsername());

  const handleJoin = () => {
    if (!roomId.trim() || !username.trim()) return;
    if (status !== "connected") onConnect();
    onJoin(roomId.trim(), username.trim());
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md bg-card border-border quantum-glow-strong">
        <CardHeader className="text-center pb-4">
          <div className="text-5xl mb-3">⚛🔐</div>
          <CardTitle className="text-xl text-slate-100">
            Quantum-LLM Secure Chat
          </CardTitle>
          <p className="text-sm text-slate-400 mt-1">
            BB84 QKD · AES-256-GCM · Local LLM
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">Username</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Alice"
              className="bg-secondary/50 border-border"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-slate-400">Room ID</Label>
            <div className="flex gap-2">
              <Input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="alpha-42"
                className="bg-secondary/50 border-border flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRoomId(randomRoomId())}
                className="border-border text-slate-400"
                title="Random room"
              >
                🎲
              </Button>
            </div>
          </div>
          <Button
            onClick={handleJoin}
            disabled={!roomId.trim() || !username.trim() || status === "connecting"}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {status === "connecting" ? "Connecting…" : "🔐 Join Secure Room"}
          </Button>

          <div className="pt-2 border-t border-border grid grid-cols-3 gap-2 text-center text-[10px] text-slate-600">
            <div>⚛ Qiskit BB84<br />simulation</div>
            <div>🔑 AES-256-GCM<br />encryption</div>
            <div>🤖 Mistral-Nemo<br />LLM replies</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}