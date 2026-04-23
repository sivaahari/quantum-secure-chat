// frontend/src/components/QuantumKeyPanel.tsx
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button }  from "@/components/ui/button";
import { Badge }   from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch }  from "@/components/ui/switch";
import { Label }   from "@/components/ui/label";
import { BlochSphereViz } from "@/components/BlochSphereViz";
import type { KeyInfo, BB84Stats } from "@/types";
import { qberStatus, shortenHex, formatTime } from "@/lib/utils";

interface QuantumKeyPanelProps {
  roomId:      string;
  keyInfo:     KeyInfo | null;
  bb84Stats:   BB84Stats | null;
  qberHistory: KeyInfo[];
  generating:  boolean;
  onGenerate:  (opts: {
    numQubits:     number;
    noiseEnabled:  boolean;
    depolarProb:   number;
    eavesdropProb: number;
  }) => void;
}

export function QuantumKeyPanel({
  roomId, keyInfo, bb84Stats, qberHistory, generating, onGenerate,
}: QuantumKeyPanelProps) {
  const [numQubits,     setNumQubits]     = useState(256);
  const [noiseEnabled,  setNoiseEnabled]  = useState(true);
  const [depolarProb,   setDepolarProb]   = useState(0.02);
  const [eavesdropProb, setEavesdropProb] = useState(0.0);
  const [showBitTable,  setShowBitTable]  = useState(false);

  const qber  = keyInfo ? qberStatus(keyInfo.qber) : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
      {/* ── Left column: Controls + Stats ── */}
      <div className="flex flex-col gap-4">
        {/* Generate controls */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="text-primary">⚛</span>
              BB84 Key Generation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Qubit count */}
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">
                Qubits: <span className="text-primary font-mono">{numQubits}</span>
              </Label>
              <input
                type="range" min={64} max={512} step={64}
                value={numQubits}
                onChange={(e) => setNumQubits(Number(e.target.value))}
                className="w-full accent-primary h-1.5 rounded"
              />
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>64</span><span>256</span><span>512</span>
              </div>
            </div>

            {/* Noise toggle */}
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-400">
                Depolarizing noise
                <span className="ml-1 font-mono text-slate-500">
                  ({(depolarProb * 100).toFixed(0)}%)
                </span>
              </Label>
              <Switch
                checked={noiseEnabled}
                onCheckedChange={setNoiseEnabled}
                className="scale-75"
              />
            </div>

            {noiseEnabled && (
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-400">
                  Depolarizing prob: <span className="font-mono text-amber-400">{depolarProb.toFixed(3)}</span>
                </Label>
                <input
                  type="range" min={0} max={0.1} step={0.005}
                  value={depolarProb}
                  onChange={(e) => setDepolarProb(Number(e.target.value))}
                  className="w-full accent-amber-500 h-1.5 rounded"
                />
              </div>
            )}

            {/* Eavesdropper simulation */}
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">
                Eavesdrop prob (Eve): <span className="font-mono text-red-400">{eavesdropProb.toFixed(2)}</span>
              </Label>
              <input
                type="range" min={0} max={0.3} step={0.05}
                value={eavesdropProb}
                onChange={(e) => setEavesdropProb(Number(e.target.value))}
                className="w-full accent-red-500 h-1.5 rounded"
              />
              {eavesdropProb > 0 && (
                <p className="text-[10px] text-red-400">
                  ⚠ Simulating Eve intercept-resend attack
                </p>
              )}
            </div>

            <Button
              onClick={() => onGenerate({ numQubits, noiseEnabled, depolarProb, eavesdropProb })}
              disabled={generating}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {generating
                ? "⚛ Simulating BB84 circuit…"
                : "⚛ Generate Quantum Key"}
            </Button>
          </CardContent>
        </Card>

        {/* Key stats */}
        {keyInfo && bb84Stats && (
          <Card className="bg-card border-border quantum-glow">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                🔑 Key Statistics
                <Badge className="ml-auto font-mono text-[10px]">
                  v{keyInfo.key_version}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* QBER */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">QBER (Quantum Bit Error Rate)</span>
                <span className={`text-sm font-mono font-semibold ${qber?.cls}`}>
                  {qber?.text}
                </span>
              </div>

              <Separator className="bg-border/50" />

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {[
                  ["Raw qubits",       bb84Stats.raw_key_length],
                  ["Sifted bits",      bb84Stats.sifted_key_length],
                  ["Final key",        `${bb84Stats.final_key_length} bits`],
                  ["Sift efficiency",  `${(bb84Stats.sifting_efficiency * 100).toFixed(1)}%`],
                  ["Sim time",         `${bb84Stats.simulation_time_ms.toFixed(0)} ms`],
                  ["Noise",            bb84Stats.noise_enabled ? "ON" : "OFF"],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex flex-col gap-0.5">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-mono text-slate-200">{value}</span>
                  </div>
                ))}
              </div>

              <Separator className="bg-border/50" />

              {/* Key hex preview */}
              <div>
                <span className="text-xs text-slate-500">Key hex (AES-256 derived)</span>
                <div className="mt-1 font-mono text-[11px] text-emerald-400 break-all bg-black/30 rounded px-2 py-1.5">
                  {bb84Stats.final_key_hex}
                </div>
              </div>

              {/* Messages used */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Messages used</span>
                <span className={`text-xs font-mono ${keyInfo.needs_refresh ? "text-amber-400" : "text-slate-300"}`}>
                  {keyInfo.messages_used} / 5
                  {keyInfo.needs_refresh && " — refresh pending"}
                </span>
              </div>

              {/* Bit table toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBitTable(!showBitTable)}
                className="w-full text-xs border-border"
              >
                {showBitTable ? "Hide" : "Show"} sifted bit sample
              </Button>

              {showBitTable && (
                <div className="bg-black/30 rounded p-2 overflow-x-auto">
                  <table className="w-full text-[9px] font-mono">
                    <thead>
                      <tr className="text-slate-500">
                        <td className="pb-1">Bit#</td>
                        {bb84Stats.alice_sifted_sample.map((_, i) => (
                          <td key={i} className="text-center px-0.5">{i}</td>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="text-slate-500 pr-2">Alice</td>
                        {bb84Stats.alice_sifted_sample.map((b, i) => (
                          <td key={i} className={`text-center px-0.5 ${b === 1 ? "text-primary" : "text-slate-400"}`}>{b}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="text-slate-500 pr-2">Bob</td>
                        {bb84Stats.bob_sifted_sample.map((b, i) => (
                          <td key={i} className={`text-center px-0.5 ${b !== bb84Stats.alice_sifted_sample[i] ? "text-red-400" : "text-slate-400"}`}>{b}</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="text-slate-500 pr-2">Basis</td>
                        {bb84Stats.alice_bases_sample.map((b, i) => (
                          <td key={i} className="text-center px-0.5 text-amber-500">
                            {b === 0 ? "+" : "×"}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Right column: Bloch Sphere ── */}
      <div className="flex flex-col gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              🌐 Bloch Sphere — Qubit States
            </CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <BlochSphereViz
              vectors={bb84Stats?.bloch_vectors ?? []}
            />
          </CardContent>
        </Card>

        {/* BER bar chart */}
        {bb84Stats && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Bit Error Rate Visualization</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {/* QBER bar */}
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>QBER</span>
                    <span className={qber?.cls}>{qber?.text}</span>
                  </div>
                  <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        bb84Stats.qber < 0.05 ? "bg-emerald-500" :
                        bb84Stats.qber < 0.11 ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${Math.min(bb84Stats.qber * 100 / 11 * 100, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
                    <span>0%</span>
                    <span className="text-emerald-700">safe &lt;11%</span>
                    <span>11%+</span>
                  </div>
                </div>

                {/* Sifting efficiency bar */}
                <div>
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Sifting efficiency</span>
                    <span className="text-slate-300 font-mono">
                      {(bb84Stats.sifting_efficiency * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/70 rounded-full transition-all duration-700"
                      style={{ width: `${bb84Stats.sifting_efficiency * 100}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-slate-600 mt-0.5">
                    Expected ~50% (random basis agreement)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* QBER history sparkline */}
        {qberHistory.length > 0 && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                📈 QBER History
                <span className="text-[10px] font-normal text-slate-500 ml-auto">
                  {qberHistory.length} key{qberHistory.length !== 1 ? "s" : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <QBERSparkline history={qberHistory} />
              <div className="flex items-center gap-3 mt-2 text-[9px] text-slate-500">
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" /> Safe (&lt;5%)</span>
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-amber-500" /> Warning (5–11%)</span>
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-500" /> Abort (&gt;11%)</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Inline SVG sparkline — no external chart library ──────────────────────────

function QBERSparkline({ history }: { history: KeyInfo[] }) {
  const W = 280, H = 90;
  const PAD = { top: 8, right: 8, bottom: 20, left: 28 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Y axis: 0 → 15% (so the 11% abort line is visible with headroom)
  const Y_MAX = 0.15;
  const toY = (v: number) => PAD.top + innerH - (v / Y_MAX) * innerH;
  const toX = (i: number) => PAD.left + (history.length === 1 ? innerW / 2 : (i / (history.length - 1)) * innerW);

  // Abort threshold at 11%
  const abortY = toY(0.11);
  // Safe threshold at 5%
  const safeY  = toY(0.05);

  // SVG polyline points
  const points = history.map((ki, i) => `${toX(i)},${toY(ki.qber)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {/* Threshold bands */}
      <rect x={PAD.left} y={abortY} width={innerW} height={innerH - (abortY - PAD.top)} fill="rgb(239 68 68 / 0.07)" />
      <rect x={PAD.left} y={safeY}  width={innerW} height={abortY - safeY}               fill="rgb(245 158 11 / 0.07)" />
      <rect x={PAD.left} y={PAD.top} width={innerW} height={safeY - PAD.top}              fill="rgb(16 185 129 / 0.07)" />

      {/* Threshold lines */}
      <line x1={PAD.left} y1={abortY} x2={PAD.left + innerW} y2={abortY} stroke="rgb(239 68 68 / 0.5)"  strokeWidth="1" strokeDasharray="3 2" />
      <line x1={PAD.left} y1={safeY}  x2={PAD.left + innerW} y2={safeY}  stroke="rgb(245 158 11 / 0.4)" strokeWidth="1" strokeDasharray="3 2" />

      {/* Threshold labels */}
      <text x={PAD.left - 2} y={abortY + 3} textAnchor="end" fontSize="7" fill="rgb(239 68 68 / 0.7)">11%</text>
      <text x={PAD.left - 2} y={safeY  + 3} textAnchor="end" fontSize="7" fill="rgb(245 158 11 / 0.7)">5%</text>
      <text x={PAD.left - 2} y={PAD.top + innerH + 3} textAnchor="end" fontSize="7" fill="rgb(100 116 139)">0%</text>

      {/* Line */}
      {history.length > 1 && (
        <polyline points={points} fill="none" stroke="rgb(99 102 241 / 0.6)" strokeWidth="1.5" strokeLinejoin="round" />
      )}

      {/* Data points */}
      {history.map((ki, i) => {
        const cx = toX(i), cy = toY(ki.qber);
        const col = ki.qber < 0.05 ? "rgb(16 185 129)" : ki.qber < 0.11 ? "rgb(245 158 11)" : "rgb(239 68 68)";
        return (
          <g key={ki.key_version}>
            <circle cx={cx} cy={cy} r="4" fill={col} opacity="0.9" />
            {/* Version label below x-axis */}
            <text x={cx} y={H - 4} textAnchor="middle" fontSize="7" fill="rgb(100 116 139)">
              v{ki.key_version}
            </text>
          </g>
        );
      })}

      {/* Y-axis line */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH} stroke="rgb(51 65 85)" strokeWidth="1" />
      {/* X-axis line */}
      <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke="rgb(51 65 85)" strokeWidth="1" />
    </svg>
  );
}