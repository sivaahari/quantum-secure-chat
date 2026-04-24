// frontend/src/components/RoomAccessPage.tsx
/**
 * Regular user's home screen after login:
 *  - Shows rooms they have access to
 *  - Allows requesting access to new rooms
 *  - Shows status of pending requests
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { Badge }  from "@/components/ui/badge";
import { Label }  from "@/components/ui/label";
import { toast }  from "sonner";
import type { AuthUser } from "@/hooks/useAuth";

const BACKEND = (import.meta.env.VITE_BACKEND_URL ?? "http://localhost:5000").replace(/\/$/, "");

interface RoomAccessPageProps {
  token:       string;
  user:        AuthUser;
  onEnterRoom: (roomId: string) => void;
  onLogout:    () => void;
}

export function RoomAccessPage({ token, user, onEnterRoom, onLogout }: RoomAccessPageProps) {
  const [myRooms,    setMyRooms]    = useState<any[]>([]);
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [roomId,     setRoomId]     = useState("");
  const [message,    setMessage]    = useState("");
  const [requesting, setRequesting] = useState(false);

  const api = useCallback(async (path: string, method = "GET", body?: object) => {
    const res = await fetch(`${BACKEND}${path}`, {
      method,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }, [token]);

  const refresh = useCallback(async () => {
    const [rooms, reqs] = await Promise.all([
      api("/admin/my-rooms"),
      api("/admin/my-requests"),
    ]);
    if (rooms.ok) setMyRooms(rooms.rooms);
    if (reqs.ok)  setMyRequests(reqs.requests);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRequest = async () => {
    if (!roomId.trim()) return;
    setRequesting(true);
    const res = await api("/admin/request-access", "POST", {
      room_id: roomId.trim(),
      message: message.trim(),
    });
    setRequesting(false);
    if (res.ok) {
      toast.success("Request submitted — waiting for admin approval");
      setRoomId("");
      setMessage("");
      refresh();
    } else {
      toast.error(res.error);
    }
  };

  const pendingRequests  = myRequests.filter((r) => r.status === "pending");
  const approvedRequests = myRequests.filter((r) => r.status === "approved");
  const rejectedRequests = myRequests.filter((r) => r.status === "rejected");

  return (
    <div className="min-h-screen bg-background p-4">
      {/* Header */}
      <div className="max-w-lg mx-auto mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-primary">⚛ Quantum-Secure</span>
          <Badge variant="outline" className="text-[10px] border-border text-slate-500">
            {user.username}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onLogout}
          className="text-xs text-slate-500 hover:text-red-400">
          Sign out
        </Button>
      </div>

      <div className="max-w-lg mx-auto space-y-4">

        {/* My accessible rooms */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">🚪 Your Rooms</CardTitle>
          </CardHeader>
          <CardContent>
            {myRooms.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">
                You don't have access to any rooms yet.<br/>
                Request access below.
              </p>
            ) : (
              <div className="space-y-2">
                {myRooms.map((room) => (
                  <div key={room.room_id}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 border border-border">
                    <div>
                      <span className="text-sm font-mono text-slate-200">#{room.room_id}</span>
                      <span className="text-[10px] text-slate-500 ml-2">
                        {room.message_count ?? 0} msgs
                        {room.has_key ? " · 🔑 key active" : ""}
                      </span>
                    </div>
                    <Button size="sm" onClick={() => onEnterRoom(room.room_id)}
                      className="text-xs bg-primary text-primary-foreground hover:bg-primary/90">
                      Enter →
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Request room access */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">📩 Request Room Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Room ID</Label>
              <Input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="e.g. research-lab"
                className="bg-secondary/50 border-border text-sm"
                disabled={requesting}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Message (optional)</Label>
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Why do you need access?"
                className="bg-secondary/50 border-border text-sm"
                disabled={requesting}
              />
            </div>
            <Button
              onClick={handleRequest}
              disabled={requesting || !roomId.trim()}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {requesting ? "Submitting…" : "📩 Request Access"}
            </Button>
          </CardContent>
        </Card>

        {/* Request history */}
        {myRequests.length > 0 && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">📋 Your Requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {myRequests.map((req) => (
                <div key={req.request_id}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/20 border border-border">
                  <div>
                    <span className="text-xs font-mono text-slate-300">#{req.room_id}</span>
                    <div className="text-[10px] text-slate-500">
                      {new Date(req.created_at * 1000).toLocaleDateString()}
                    </div>
                  </div>
                  <Badge className={`text-[9px] ${
                    req.status === "approved" ? "bg-emerald-900/60 text-emerald-300 border-emerald-700/40" :
                    req.status === "pending"  ? "bg-amber-900/60  text-amber-300  border-amber-700/40 animate-pulse" :
                    "bg-red-900/60 text-red-300 border-red-700/40"
                  }`}>
                    {req.status}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}