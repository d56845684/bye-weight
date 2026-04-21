"use client";

// 分部位肌肉 / 脂肪示意圖。5 塊區域：左右臂 / 軀幹 / 左右腿。
// 每塊顏色深度根據「實際值 / 目標值」的比例（0~1）漸變；沒目標就用固定深度。
// Port from design/med/charts.jsx BodyMap。

type Seg = {
  la: number | null;
  ra: number | null;
  tr: number | null;
  ll: number | null;
  rl: number | null;
};

export function BodyMap({
  seg,
  target,
  accent = "#0d9488",
  textColor = "#374151",
}: {
  seg: Seg | null;
  target?: Seg | null;
  accent?: string;
  textColor?: string;
}) {
  if (!seg) {
    return (
      <div className="text-center text-xs text-gray-400 py-12">
        尚無分部位資料
        <div className="text-[10px] text-gray-300 mt-1">InBody 詳細報告會提供</div>
      </div>
    );
  }

  const pct = (k: keyof Seg) => {
    const v = seg[k];
    const t = target?.[k];
    if (v === null || v === undefined) return 0.4;
    if (!t || t === 0) return 0.6;
    return Math.min(1, Math.max(0, v / t));
  };
  const fill = (k: keyof Seg) => {
    const [r, g, b] = hexToRgb(accent);
    return `rgba(${r},${g},${b},${(0.15 + pct(k) * 0.6).toFixed(2)})`;
  };
  const label = (k: keyof Seg) => (seg[k] !== null && seg[k] !== undefined ? String(seg[k]) : "—");

  return (
    <svg viewBox="0 0 220 300" width="100%" style={{ display: "block", maxHeight: 260 }}>
      {/* Head */}
      <circle cx="110" cy="30" r="18" fill="none" stroke={accent} strokeWidth="1.2" opacity="0.5" />
      {/* Trunk */}
      <path d="M78 56 Q110 46 142 56 L148 150 Q110 158 72 150 Z"
            fill={fill("tr")} stroke={accent} strokeWidth="1" />
      {/* Left arm */}
      <path d="M78 58 L58 80 L50 140 L58 150 L70 148 L72 90 Z"
            fill={fill("la")} stroke={accent} strokeWidth="1" />
      {/* Right arm */}
      <path d="M142 58 L162 80 L170 140 L162 150 L150 148 L148 90 Z"
            fill={fill("ra")} stroke={accent} strokeWidth="1" />
      {/* Left leg */}
      <path d="M78 150 L74 250 L80 282 L98 282 L100 254 L104 150 Z"
            fill={fill("ll")} stroke={accent} strokeWidth="1" />
      {/* Right leg */}
      <path d="M142 150 L146 250 L140 282 L122 282 L120 254 L116 150 Z"
            fill={fill("rl")} stroke={accent} strokeWidth="1" />

      {/* Labels */}
      <text x="18" y="104" fontSize="9" fill={textColor} fontFamily="ui-monospace, monospace">LA {label("la")}</text>
      <text x="178" y="104" fontSize="9" fill={textColor} fontFamily="ui-monospace, monospace">RA {label("ra")}</text>
      <text x="88" y="108" fontSize="10" fill={textColor} fontFamily="ui-monospace, monospace" fontWeight="600">TR {label("tr")}</text>
      <text x="40" y="210" fontSize="9" fill={textColor} fontFamily="ui-monospace, monospace">LL {label("ll")}</text>
      <text x="156" y="210" fontSize="9" fill={textColor} fontFamily="ui-monospace, monospace">RL {label("rl")}</text>
    </svg>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [13, 148, 136];
}
