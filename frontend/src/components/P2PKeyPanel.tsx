// frontend/src/components/P2PKeyPanel.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button }    from "@/components/ui/button";
import { Badge }     from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { BlochSphereViz } from "@/components/BlochSphereViz";
import type { P2PKeyStatus } from "@/hooks/useP2PKey";
import type { RTCStatus }    from "@/hooks/useWebRTC";
import type { P2PRole }      from "@/lib/webrtc";
import type { BB84KeyResult } from "@/lib/bb84";
import { qberStatus, safetyNumber } from "@/lib/utils";

interface P2PKeyPanelProps {
  role:        P2PRole | null;
  rtcStatus:   RTCStatus;
  keyStatus:   P2PKeyStatus;
  keyResult:   BB84KeyResult | null;
  progress:    number;
  log:         string[];
  onInitiate:  () => void;     // Alice clicks "Start BB84"
  onReset:     () => void;
}

const STATUS_LABELS: Record<P2PKeyStatus, string> = {
  idle:           "Waiting",
  preparing:      "Preparing qubits…",
  transmitting:   "Transmitting quantum states…",
  measuring:      "Bob measuring…",
  sifting:        "Sifting bases…",
  estimating_qber:"Estimating QBER…",
  deriving:       "Deriving AES-256 key…",
  complete:       "✅ Key established",
  aborted:        "❌ Aborted",
  error:          "❌ Error",
};

export function P2PKeyPanel({
  role, rtcStatus, keyStatus, keyResult,
  progress, log, onInitiate, onReset,
}: P2PKeyPanelProps) {
  const qber  = keyResult ? qberStatus(keyResult.qber) : null;
  const ready = rtcStatus === "connected";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">

      {/* ── Left: Controls + Log ── */}
      <div className="flex flex-col gap-4">

        {/* Connection status card */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="text-primary">🔗</span>
              Peer-to-Peer Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">WebRTC Status</span>
              <Badge
                variant="outline"
                className={`text-[10px] font-mono ${
                  rtcStatus === "connected"
                    ? "border-emerald-700 text-emerald-400"
                    : rtcStatus === "error"
                    ? "border-red-700 text-red-400"
                    : "border-amber-700 text-amber-400"
                }`}
              >
                {rtcStatus}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Your role</span>
              <Badge variant="outline" className="text-[10px] font-mono border-primary/40 text-primary">
                {role === "alice" ? "🔬 Alice (initiator)" : role === "bob" ? "📡 Bob (responder)" : "—"}
              </Badge>
            </div>

            {!ready && (
              <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-700/30">
                <p className="text-xs text-amber-400">
                  {rtcStatus === "idle"
                    ? "⚡ Waiting for a second user to join this room. Share the Room ID."
                    : "🔗 Establishing peer-to-peer connection…"}
                </p>
              </div>
            )}

            {ready && (
              <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-700/30">
                <p className="text-xs text-emerald-400">
                  ✅ Direct browser-to-browser connection established.
                  The server cannot see what follows.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* BB84 controls */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="text-primary">⚛</span>
              BB84 Key Exchange — P2P Mode
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                <span>{STATUS_LABELS[keyStatus]}</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    keyStatus === "complete" ? "bg-emerald-500" :
                    keyStatus === "aborted"  ? "bg-red-500"     :
                    "bg-primary"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              {role === "alice" && (
                <Button
                  onClick={onInitiate}
                  disabled={!ready || keyStatus === "complete" || (keyStatus !== "idle" && keyStatus !== "aborted" && keyStatus !== "error")}
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {keyStatus === "idle" || keyStatus === "aborted"
                    ? "⚛ Start BB84 Exchange"
                    : keyStatus === "complete"
                    ? "✅ Key Ready"
                    : "⚛ Exchanging…"}
                </Button>
              )}
              {role === "bob" && (
                <div className="flex-1 p-3 rounded-lg bg-violet-950/30 border border-violet-700/30">
                  <p className="text-xs text-violet-400 text-center">
                    {keyStatus === "idle"
                      ? "⏳ Waiting for Alice to initiate BB84…"
                      : keyStatus === "complete"
                      ? "✅ Key received and derived"
                      : "📡 Receiving quantum states…"}
                  </p>
                </div>
              )}
              <Button
                onClick={onReset}
                variant="outline"
                size="sm"
                className="border-border text-slate-400"
                disabled={keyStatus === "idle"}
              >
                ↺ Reset
              </Button>
            </div>

            {/* Key stats */}
            {keyResult && keyStatus === "complete" && (
              <>
                <Separator className="bg-border/50" />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">QBER</span>
                    <span className={`text-sm font-mono font-semibold ${qber?.cls}`}>
                      {qber?.text}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    {([
                      ["Raw qubits",   keyResult.rawQubits],
                      ["Sifted bits",  keyResult.siftedBits],
                      ["Final key",    "256 bits (AES-256)"],
                      ["Efficiency",   `${(keyResult.efficiency * 100).toFixed(1)}%`],
                    ] as [string, string | number][]).map(([label, value]) => (
                      <div key={label} className="flex flex-col gap-0.5">
                        <span className="text-slate-500">{label}</span>
                        <span className="font-mono text-slate-200">{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="font-mono text-[11px] text-emerald-400 break-all bg-black/30 rounded px-2 py-1.5">
                    {keyResult.keyHex}
                  </div>

                  {/* Safety number — compare out-of-band with peer */}
                  <div className="rounded-lg border border-violet-700/50 bg-violet-950/30 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-violet-300 uppercase tracking-wider">
                        🛡 Safety Number
                      </span>
                      <Badge variant="outline" className="text-[9px] border-violet-700/50 text-violet-400 ml-auto">
                        compare out-of-band
                      </Badge>
                    </div>
                    <div className="font-mono text-lg tracking-[0.25em] text-violet-200 text-center py-1 select-all">
                      {safetyNumber(keyResult.keyHex)}
                    </div>
                    <p className="text-[10px] text-violet-400/80 text-center">
                      Read this to your peer verbally. If it matches on both sides, no MITM attack occurred.
                    </p>
                  </div>

                  <div className="p-2 rounded-lg bg-emerald-950/20 border border-emerald-800/30">
                    <p className="text-[10px] text-emerald-500">
                      🔐 This key was derived entirely in your browser via WebRTC DataChannel.
                      The server never saw any key material.
                    </p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Right: Log + Architecture ── */}
      <div className="flex flex-col gap-4">

        {/* Step-by-step log */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              📋 Protocol Log
              <Badge variant="outline" className="text-[9px] ml-auto border-border text-slate-500">
                live
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-black/40 rounded-lg p-3 h-48 overflow-y-auto font-mono text-[10px] space-y-1">
              {log.length === 0 ? (
                <p className="text-slate-600">Protocol steps will appear here…</p>
              ) : (
                log.map((entry, i) => (
                  <div key={i} className={`${
                    entry.includes("✅") ? "text-emerald-400" :
                    entry.includes("❌") ? "text-red-400"     :
                    entry.includes("⚛") ? "text-primary"     :
                    entry.includes("📊") ? "text-amber-400"   :
                    "text-slate-400"
                  }`}>
                    {entry}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Architecture explainer */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">🏗 P2P Architecture</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-[10px] text-slate-400 space-y-1 bg-black/20 rounded-lg p-3">
              <div className="text-primary">Alice (your browser)</div>
              <div>  ↓ random bits + bases</div>
              <div className="text-amber-400">  ↓ [qubit states via DataChannel]</div>
              <div>  ↓ Bob measures in random bases</div>
              <div className="text-amber-400">  ↓ [bases exchanged via DataChannel]</div>
              <div>  ↓ both sift → QBER check</div>
              <div className="text-amber-400">  ↓ [QBER sample via DataChannel]</div>
              <div>  ↓ HKDF-SHA256 on each side</div>
              <div className="text-emerald-400">  ✅ identical AES-256 keys</div>
              <div className="text-slate-600 mt-2">Server (Railway): SDP/ICE only</div>
              <div className="text-slate-600">Server NEVER sees key material</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}