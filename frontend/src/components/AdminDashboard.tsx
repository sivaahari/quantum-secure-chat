// frontend/src/components/AdminDashboard.tsx
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import { Input }  from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast }  from "sonner";

const BACKEND = (import.meta.env.VITE_BACKEND_URL ?? "http://localhost:5000").replace(/\/$/, "");

interface AdminDashboardProps {
  token:     string;
  onEnterRoom: (roomId: string) => void;
}

function useAdminApi(token: string) {
  const call = useCallback(async (path: string, method = "GET", body?: object) => {
    const res  = await fetch(`${BACKEND}${path}`, {
      method,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }, [token]);
  return call;
}

export function AdminDashboard({ token, onEnterRoom }: AdminDashboardProps) {
  const api = useAdminApi(token);

  const [stats,        setStats]        = useState<any>(null);
  const [users,        setUsers]        = useState<any[]>([]);
  const [rooms,        setRooms]        = useState<any[]>([]);
  const [requests,     setRequests]     = useState<any[]>([]);
  const [newRoomId,    setNewRoomId]    = useState("");
  const [creating,     setCreating]     = useState(false);
  const [tab,          setTab]          = useState("overview");

  const refresh = useCallback(async () => {
    const [s, u, r, j] = await Promise.all([
      api("/admin/stats"),
      api("/admin/users"),
      api("/admin/rooms"),
      api("/admin/join-requests"),
    ]);
    if (s.ok)  setStats(s);
    if (u.ok)  setUsers(u.users);
    if (r.ok)  setRooms(r.rooms);
    if (j.ok)  setRequests(j.requests);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const approveUser = async (user_id: string) => {
    const res = await api(`/admin/users/${user_id}/approve`, "POST");
    if (res.ok) { toast.success(res.message); refresh(); }
    else toast.error(res.error);
  };

  const rejectUser = async (user_id: string) => {
    const res = await api(`/admin/users/${user_id}/reject`, "POST");
    if (res.ok) { toast.success(res.message); refresh(); }
    else toast.error(res.error);
  };

  const approveRequest = async (request_id: string) => {
    const res = await api(`/admin/join-requests/${request_id}/approve`, "POST");
    if (res.ok) { toast.success(res.message); refresh(); }
    else toast.error(res.error);
  };

  const rejectRequest = async (request_id: string) => {
    const res = await api(`/admin/join-requests/${request_id}/reject`, "POST");
    if (res.ok) { toast.success(res.message); refresh(); }
    else toast.error(res.error);
  };

  const createRoom = async () => {
    if (!newRoomId.trim()) return;
    setCreating(true);
    const res = await api("/admin/rooms", "POST", { room_id: newRoomId.trim() });
    setCreating(false);
    if (res.ok) {
      toast.success(res.message);
      setNewRoomId("");
      refresh();
    } else {
      toast.error(res.error);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Admin header */}
      <div className="px-4 py-2.5 border-b border-border bg-violet-950/30 flex-shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-violet-300">👑 Admin Dashboard</span>
          {stats && (
            <div className="flex gap-2">
              {stats.pending_users > 0 && (
                <Badge className="text-[10px] bg-amber-900/60 text-amber-300 border-amber-700/40 animate-pulse">
                  {stats.pending_users} user{stats.pending_users !== 1 ? "s" : ""} pending
                </Badge>
              )}
              {stats.pending_requests > 0 && (
                <Badge className="text-[10px] bg-blue-900/60 text-blue-300 border-blue-700/40 animate-pulse">
                  {stats.pending_requests} room request{stats.pending_requests !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} className="text-xs text-slate-400">
          ↻ Refresh
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 overflow-hidden min-h-0">
        <TabsList className="grid grid-cols-4 w-full rounded-none border-b border-border bg-card/50 h-8 flex-shrink-0">
          {[
            ["overview", "📊 Overview"],
            ["users",    `👥 Users${stats?.pending_users ? ` (${stats.pending_users})` : ""}`],
            ["rooms",    "🚪 Rooms"],
            ["requests", `📩 Requests${stats?.pending_requests ? ` (${stats.pending_requests})` : ""}`],
          ].map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="text-[10px] rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-violet-400">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="flex-1 overflow-auto p-4 m-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: "Total Users",       value: stats?.total_users        ?? "…", color: "text-slate-200" },
              { label: "Pending Approval",  value: stats?.pending_users      ?? "…", color: "text-amber-400"  },
              { label: "Active Rooms",      value: stats?.total_rooms        ?? "…", color: "text-emerald-400"},
              { label: "Room Requests",     value: stats?.pending_requests   ?? "…", color: "text-blue-400"   },
            ].map(({ label, value, color }) => (
              <Card key={label} className="bg-card border-border">
                <CardContent className="p-3 text-center">
                  <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Quick room entry */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Enter a Room</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {rooms.length === 0 ? (
                  <p className="text-xs text-slate-500">No rooms yet. Create one in the Rooms tab.</p>
                ) : (
                  rooms.map((room) => (
                    <div key={room.room_id} className="flex items-center justify-between p-2 rounded-lg bg-secondary/30 border border-border">
                      <div>
                        <span className="text-sm font-mono text-slate-200">#{room.room_id}</span>
                        <span className="text-[10px] text-slate-500 ml-2">
                          {room.member_count} member{room.member_count !== 1 ? "s" : ""}
                          {room.has_key ? " · 🔑 key active" : ""}
                        </span>
                      </div>
                      <Button size="sm" onClick={() => onEnterRoom(room.room_id)}
                        className="text-xs bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30">
                        Enter →
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Users ── */}
        <TabsContent value="users" className="flex-1 overflow-auto p-4 m-0 space-y-3">
          {users.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">No users registered yet.</p>
          ) : (
            users.map((user) => (
              <div key={user.user_id}
                className="flex items-center justify-between p-3 rounded-lg bg-card border border-border">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    user.status === "approved" ? "bg-emerald-400" :
                    user.status === "pending"  ? "bg-amber-400 animate-pulse" :
                    "bg-red-400"
                  }`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200 truncate">
                        {user.username}
                      </span>
                      {user.role === "admin" && (
                        <Badge className="text-[9px] bg-violet-900/60 text-violet-300 border-violet-700/40">
                          admin
                        </Badge>
                      )}
                    </div>
                    <span className={`text-[10px] ${
                      user.status === "approved" ? "text-emerald-500" :
                      user.status === "pending"  ? "text-amber-500"   :
                      "text-red-500"
                    }`}>
                      {user.status}
                    </span>
                  </div>
                </div>

                {user.status === "pending" && (
                  <div className="flex gap-2 flex-shrink-0">
                    <Button size="sm" onClick={() => approveUser(user.user_id)}
                      className="text-xs bg-emerald-900/40 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-900/60">
                      ✓ Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => rejectUser(user.user_id)}
                      className="text-xs border-red-700/40 text-red-400 hover:bg-red-950/40">
                      ✗ Reject
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </TabsContent>

        {/* ── Rooms ── */}
        <TabsContent value="rooms" className="flex-1 overflow-auto p-4 m-0 space-y-3">
          {/* Create room */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Create New Room</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  value={newRoomId}
                  onChange={(e) => setNewRoomId(e.target.value)}
                  placeholder="room-id (e.g. research-lab)"
                  className="bg-secondary/50 border-border text-sm"
                  onKeyDown={(e) => e.key === "Enter" && createRoom()}
                  disabled={creating}
                />
                <Button onClick={createRoom} disabled={creating || !newRoomId.trim()}
                  className="bg-primary text-primary-foreground whitespace-nowrap">
                  {creating ? "…" : "+ Create"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {rooms.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No rooms yet.</p>
          ) : (
            rooms.map((room) => (
              <div key={room.room_id}
                className="flex items-center justify-between p-3 rounded-lg bg-card border border-border">
                <div>
                  <span className="text-sm font-mono text-slate-200">#{room.room_id}</span>
                  <div className="text-[10px] text-slate-500">
                    {room.member_count} member{room.member_count !== 1 ? "s" : ""}
                    {room.has_key ? " · 🔑 key active" : " · no key"}
                    {room.message_count != null && ` · ${room.message_count} msgs`}
                  </div>
                </div>
                <Button size="sm" onClick={() => onEnterRoom(room.room_id)}
                  className="text-xs bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30">
                  Enter →
                </Button>
              </div>
            ))
          )}
        </TabsContent>

        {/* ── Join Requests ── */}
        <TabsContent value="requests" className="flex-1 overflow-auto p-4 m-0 space-y-3">
          {requests.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">No pending room requests.</p>
          ) : (
            requests.map((req) => (
              <div key={req.request_id}
                className="p-3 rounded-lg bg-card border border-border space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{req.username}</span>
                      <span className="text-[10px] text-slate-500">wants to join</span>
                      <span className="text-sm font-mono text-primary">#{req.room_id}</span>
                    </div>
                    {req.message && (
                      <p className="text-xs text-slate-400 mt-1 italic">"{req.message}"</p>
                    )}
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      {new Date(req.created_at * 1000).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveRequest(req.request_id)}
                    className="text-xs bg-emerald-900/40 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-900/60">
                    ✓ Grant Access
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => rejectRequest(req.request_id)}
                    className="text-xs border-red-700/40 text-red-400 hover:bg-red-950/40">
                    ✗ Reject
                  </Button>
                </div>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}