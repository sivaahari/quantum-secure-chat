// frontend/src/components/BlochSphereViz.tsx
/**
 * SVG Bloch sphere visualization for up to 8 qubits.
 *
 * Projection: oblique isometric, standard QC textbook orientation
 *   +Z = north pole (|0⟩)
 *   -Z = south pole (|1⟩)
 *   +X = equator right (|+⟩)
 *   -X = equator left (|−⟩)
 */

import type { BlochVector } from "@/types";

const CX = 140;   // sphere center X in SVG coords
const CY = 140;   // sphere center Y in SVG coords
const R  = 100;   // sphere radius in SVG coords

// Projection: 3D Bloch (x,y,z) → 2D SVG (px,py)
function project(bx: number, by: number, bz: number) {
  // Oblique projection — X goes right-down, Y goes left-down, Z goes up
  const px = CX + R * (0.6 * bx - 0.38 * by);
  const py = CY + R * (-bz + 0.28 * bx + 0.35 * by);
  return { px, py };
}

// Color per state
const STATE_COLORS: Record<string, string> = {
  "|0⟩": "#34d399",   // emerald
  "|1⟩": "#f87171",   // red
  "|+⟩": "#60a5fa",   // blue
  "|−⟩": "#f59e0b",   // amber
};

interface BlochSphereVizProps {
  vectors:   BlochVector[];
  className?: string;
}

export function BlochSphereViz({ vectors, className = "" }: BlochSphereVizProps) {
  // Axis endpoints in SVG
  const axisZ0  = project(0, 0,  1.25);
  const axisZn  = project(0, 0, -1.25);
  const axisX0  = project(1.25, 0, 0);
  const axisXn  = project(-1.25, 0, 0);
  const axisY0  = project(0,  1.25, 0);
  const axisYn  = project(0, -1.25, 0);

  // Equator ellipse (in XY plane, z=0)
  const eqPoints = Array.from({ length: 37 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    return project(Math.cos(a), Math.sin(a), 0);
  });
  const eqPath = eqPoints.map((p, i) =>
    `${i === 0 ? "M" : "L"} ${p.px.toFixed(1)} ${p.py.toFixed(1)}`
  ).join(" ") + " Z";

  // Meridian in XZ plane (y=0)
  const merPoints = Array.from({ length: 37 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    return project(Math.cos(a), 0, Math.sin(a));
  });
  const merPath = merPoints.map((p, i) =>
    `${i === 0 ? "M" : "L"} ${p.px.toFixed(1)} ${p.py.toFixed(1)}`
  ).join(" ") + " Z";

  // Meridian in YZ plane (x=0)
  const mer2Points = Array.from({ length: 37 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    return project(0, Math.cos(a), Math.sin(a));
  });
  const mer2Path = mer2Points.map((p, i) =>
    `${i === 0 ? "M" : "L"} ${p.px.toFixed(1)} ${p.py.toFixed(1)}`
  ).join(" ") + " Z";

  // North & South poles
  const north = project(0, 0,  1);
  const south = project(0, 0, -1);

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <svg
        viewBox="0 0 280 280"
        width="280"
        height="280"
        className="overflow-visible"
      >
        <defs>
          {/* Sphere gradient for 3D feel */}
          <radialGradient id="sphereGrad" cx="40%" cy="35%" r="60%">
            <stop offset="0%"   stopColor="#1e3a5f" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0a0f1e" stopOpacity="0.95" />
          </radialGradient>
          {/* Glow filter for state dots */}
          <filter id="dotGlow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Sphere body */}
        <circle
          cx={CX} cy={CY} r={R}
          fill="url(#sphereGrad)"
          stroke="#1e3a5f"
          strokeWidth="1"
        />

        {/* Meridians (dashed) */}
        <path d={merPath}  fill="none" stroke="#1e4d7a" strokeWidth="0.8" strokeDasharray="3,3" />
        <path d={mer2Path} fill="none" stroke="#1e4d7a" strokeWidth="0.8" strokeDasharray="3,3" />

        {/* Equator */}
        <path d={eqPath} fill="none" stroke="#2a6098" strokeWidth="1" strokeDasharray="4,3" />

        {/* Axes */}
        {/* Z axis (vertical) */}
        <line x1={axisZn.px} y1={axisZn.py} x2={axisZ0.px} y2={axisZ0.py}
              stroke="#64748b" strokeWidth="1" />
        {/* X axis */}
        <line x1={axisXn.px} y1={axisXn.py} x2={axisX0.px} y2={axisX0.py}
              stroke="#64748b" strokeWidth="1" />
        {/* Y axis */}
        <line x1={axisYn.px} y1={axisYn.py} x2={axisY0.px} y2={axisY0.py}
              stroke="#64748b" strokeWidth="1" />

        {/* Axis labels */}
        <text x={axisZ0.px - 8}  y={axisZ0.py - 6}   fontSize="11" fill="#94a3b8" fontWeight="600">|0⟩</text>
        <text x={axisZn.px - 8}  y={axisZn.py + 14}  fontSize="11" fill="#94a3b8" fontWeight="600">|1⟩</text>
        <text x={axisX0.px + 4}  y={axisX0.py + 4}   fontSize="10" fill="#64748b">+X</text>
        <text x={axisXn.px - 20} y={axisXn.py + 4}   fontSize="10" fill="#64748b">-X</text>
        <text x={axisY0.px + 4}  y={axisY0.py}        fontSize="10" fill="#64748b">+Y</text>

        {/* State vectors — draw lines from center, then dot */}
        {vectors.map((vec) => {
          const tip    = project(vec.x, vec.y, vec.z);
          const color  = STATE_COLORS[vec.state] ?? "#a78bfa";

          return (
            <g key={vec.qubit_index} filter="url(#dotGlow)">
              {/* Vector line from center to tip */}
              <line
                x1={CX} y1={CY}
                x2={tip.px} y2={tip.py}
                stroke={color}
                strokeWidth="1.5"
                strokeOpacity="0.6"
              />
              {/* State dot */}
              <circle
                cx={tip.px} cy={tip.py} r="5"
                fill={color}
                fillOpacity="0.9"
                stroke="white"
                strokeWidth="0.5"
              />
            </g>
          );
        })}

        {/* North/south pole markers */}
        <circle cx={north.px} cy={north.py} r="3" fill="#34d399" />
        <circle cx={south.px} cy={south.py} r="3" fill="#f87171" />

        {/* Qubit index labels (only first 5) */}
        {vectors.slice(0, 5).map((vec) => {
          const tip = project(vec.x, vec.y, vec.z);
          return (
            <text
              key={`lbl-${vec.qubit_index}`}
              x={tip.px + 7}
              y={tip.py + 4}
              fontSize="9"
              fill="#cbd5e1"
              opacity="0.8"
            >
              q{vec.qubit_index}
            </text>
          );
        })}
      </svg>

      {/* State legend */}
      <div className="flex gap-3 flex-wrap justify-center">
        {Object.entries(STATE_COLORS).map(([state, color]) => (
          <div key={state} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-slate-400 font-mono">{state}</span>
          </div>
        ))}
      </div>

      {vectors.length === 0 && (
        <p className="text-xs text-slate-500 mt-2">
          Generate a quantum key to see qubit states
        </p>
      )}
    </div>
  );
}