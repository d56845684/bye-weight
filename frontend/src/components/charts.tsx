"use client";

// 純 SVG 圖表 primitives，參考 design/med/charts.jsx 移植。
// 不依賴 Recharts — 一方面為了包體積，一方面設計稿就是這個樣子。
// null 值跳過 —— 空資料天不畫斷點，連線時繞過（線圖視情況，bar 當 0）。

import React from "react";

type Pad = { t: number; r: number; b: number; l: number };
const DEFAULT_PAD: Pad = { t: 16, r: 16, b: 24, l: 36 };

function niceTicks(min: number, max: number, count = 4) {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(min + ((max - min) * i) / count);
  return out;
}

export function LineChart({
  data,
  data2,
  dates,
  width = 320,
  height = 180,
  color = "#0d9488",
  color2,
  target,
  yDomain,
  pad = DEFAULT_PAD,
  showGrid = true,
  showDots = true,
  textColor = "#6b7280",
  gridColor = "rgba(0,0,0,0.06)",
}: {
  data: (number | null)[];
  data2?: (number | null)[];
  dates?: string[];
  width?: number;
  height?: number;
  color?: string;
  color2?: string;
  target?: number;
  yDomain?: [number, number];
  pad?: Pad;
  showGrid?: boolean;
  showDots?: boolean;
  textColor?: string;
  gridColor?: string;
}) {
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const all = [...data, ...(data2 ?? [])].filter((v): v is number => v !== null);
  if (all.length === 0) return <EmptyChart width={width} height={height} textColor={textColor} />;
  const min = yDomain ? yDomain[0] : Math.min(...all) - 0.5;
  const max = yDomain ? yDomain[1] : Math.max(...all) + 0.5;
  const x = (i: number, n = data.length) => pad.l + (i / Math.max(1, n - 1)) * w;
  const y = (v: number) => pad.t + h - ((v - min) / (max - min || 1)) * h;

  const buildPath = (series: (number | null)[]) => {
    let d = "";
    let started = false;
    series.forEach((v, i) => {
      if (v === null) { started = false; return; }
      d += `${started ? "L" : "M"}${x(i, series.length).toFixed(1)},${y(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  const lastValid = (() => {
    for (let i = data.length - 1; i >= 0; i--) if (data[i] !== null) return i;
    return -1;
  })();

  const yTicks = niceTicks(min, max, 4);
  const xTickIdx = [0, 7, 14, 21, 28].filter((i) => i < data.length);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={`lg-${color.replace("#", "")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {showGrid && yTicks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={gridColor} strokeWidth="1" />
          <text x={pad.l - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill={textColor} fontFamily="ui-monospace, monospace">
            {t.toFixed(1)}
          </text>
        </g>
      ))}
      {target != null && (
        <line x1={pad.l} x2={width - pad.r} y1={y(target)} y2={y(target)}
              stroke={color} strokeDasharray="3 3" strokeWidth="1" opacity="0.4" />
      )}
      <path d={buildPath(data)} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {data2 && <path d={buildPath(data2)} stroke={color2 ?? "#94a3b8"} strokeWidth="1.6"
                      fill="none" strokeDasharray="4 3" strokeLinecap="round" />}
      {showDots && lastValid >= 0 && (
        <g>
          <circle cx={x(lastValid)} cy={y(data[lastValid]!)} r="4" fill="white" stroke={color} strokeWidth="2" />
          <circle cx={x(lastValid)} cy={y(data[lastValid]!)} r="1.5" fill={color} />
        </g>
      )}
      {xTickIdx.map((i) => (
        <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10"
              fill={textColor} fontFamily="ui-monospace, monospace">
          {formatXLabel(dates?.[i], i)}
        </text>
      ))}
    </svg>
  );
}

export function BarChart({
  data,
  target,
  dates,
  width = 320,
  height = 160,
  color = "#0d9488",
  overColor = "#f59e0b",
  pad = DEFAULT_PAD,
  textColor = "#6b7280",
  gridColor = "rgba(0,0,0,0.06)",
}: {
  data: (number | null)[];
  target?: number;
  dates?: string[];
  width?: number;
  height?: number;
  color?: string;
  overColor?: string;
  pad?: Pad;
  textColor?: string;
  gridColor?: string;
}) {
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const valid = data.filter((v): v is number => v !== null);
  if (valid.length === 0) return <EmptyChart width={width} height={height} textColor={textColor} />;
  const max = Math.max(...valid, target ?? 0) * 1.1 || 1;
  const bw = (w / data.length) * 0.72;
  const x = (i: number) => pad.l + (i / data.length) * w + (w / data.length - bw) / 2;
  const y = (v: number) => pad.t + h - (v / max) * h;
  const yTicks = [0, max * 0.25, max * 0.5, max * 0.75, max].map((v) => Math.round(v / 100) * 100);
  const xTickIdx = [0, 7, 14, 21, 28].filter((i) => i < data.length);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block", overflow: "visible" }}>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={gridColor} strokeWidth="1" />
          <text x={pad.l - 8} y={y(t) + 3} textAnchor="end" fontSize="10"
                fill={textColor} fontFamily="ui-monospace, monospace">{t}</text>
        </g>
      ))}
      {target != null && (
        <line x1={pad.l} x2={width - pad.r} y1={y(target)} y2={y(target)}
              stroke={color} strokeDasharray="3 3" strokeWidth="1.2" opacity="0.6" />
      )}
      {data.map((v, i) => v === null ? null : (
        <rect key={i} x={x(i)} y={y(v)} width={bw} height={(pad.t + h) - y(v)} rx="1.5"
              fill={target && v > target * 1.1 ? overColor : color}
              opacity={i === data.length - 1 ? 1 : 0.85} />
      ))}
      {xTickIdx.map((i) => (
        <text key={i} x={x(i) + bw / 2} y={height - 6} textAnchor="middle" fontSize="10"
              fill={textColor} fontFamily="ui-monospace, monospace">
          {formatXLabel(dates?.[i], i)}
        </text>
      ))}
    </svg>
  );
}

export function StackedBarChart({
  data,
  dates,
  width = 320,
  height = 160,
  colors = ["#0d9488", "#f59e0b", "#a78bfa"],
  pad = DEFAULT_PAD,
  textColor = "#6b7280",
  gridColor = "rgba(0,0,0,0.06)",
}: {
  data: ({ carbs: number; protein: number; fat: number } | null)[];
  dates?: string[];
  width?: number;
  height?: number;
  colors?: [string, string, string] | string[];
  pad?: Pad;
  textColor?: string;
  gridColor?: string;
}) {
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const bw = (w / data.length) * 0.82;
  const x = (i: number) => pad.l + (i / data.length) * w + (w / data.length - bw) / 2;
  const y = (v: number) => pad.t + h - (v / 100) * h;
  const xTickIdx = [0, 7, 14, 21, 28].filter((i) => i < data.length);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block", overflow: "visible" }}>
      {[0, 25, 50, 75, 100].map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={gridColor} strokeWidth="1" />
          <text x={pad.l - 8} y={y(t) + 3} textAnchor="end" fontSize="10"
                fill={textColor} fontFamily="ui-monospace, monospace">{t}%</text>
        </g>
      ))}
      {data.map((d, i) => {
        if (!d) return null;
        const total = d.carbs + d.protein + d.fat || 1;
        const cH = ((d.carbs / total) * 100 / 100) * h;
        const pH = ((d.protein / total) * 100 / 100) * h;
        const fH = ((d.fat / total) * 100 / 100) * h;
        return (
          <g key={i}>
            <rect x={x(i)} y={pad.t + h - cH}          width={bw} height={cH} fill={colors[0]} />
            <rect x={x(i)} y={pad.t + h - cH - pH}     width={bw} height={pH} fill={colors[1]} />
            <rect x={x(i)} y={pad.t + h - cH - pH - fH} width={bw} height={fH} fill={colors[2]} />
          </g>
        );
      })}
      {xTickIdx.map((i) => (
        <text key={i} x={x(i) + bw / 2} y={height - 6} textAnchor="middle" fontSize="10"
              fill={textColor} fontFamily="ui-monospace, monospace">
          {formatXLabel(dates?.[i], i)}
        </text>
      ))}
    </svg>
  );
}

export function Ring({
  value,
  max = 100,
  size = 80,
  stroke = 8,
  color = "#0d9488",
  trackColor = "#e5e7eb",
  children,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, Math.max(0, value / max)));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
                strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
                style={{ transition: "stroke-dashoffset .5s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

function EmptyChart({ width, height, textColor }: { width: number; height: number; textColor: string }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }}>
      <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="12"
            fill={textColor} fontFamily="ui-monospace, monospace">尚無資料</text>
    </svg>
  );
}

// 把 ISO date (YYYY-MM-DD) 轉成「M/D」。design 原本 hardcode "Apr N"；這裡動態算。
function formatXLabel(dateStr: string | undefined, fallbackIdx: number): string {
  if (!dateStr) return `#${fallbackIdx + 1}`;
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}
