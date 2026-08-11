// 記録一覧に出す、ルートの小さな地図。
// タイルを読まず SVG だけで描くので、オフラインでも一覧が開けて軽い。
// 墨で引いた線のような見た目にしている。

import { useMemo } from "react";
import { toSegments } from "./geo.js";

export default function RouteThumb({ points = [], width = 96, height = 96 }) {
  const paths = useMemo(() => {
    if (!points || points.length < 2) return null;
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    // 緯度によって経度1度の実距離が縮むぶんを補正して、形が歪まないようにする
    const latMid = (minLat + maxLat) / 2;
    const kx = Math.cos((latMid * Math.PI) / 180);
    const w = Math.max((maxLng - minLng) * kx, 1e-7);
    const h = Math.max(maxLat - minLat, 1e-7);
    const pad = 8;
    const scale = Math.min((width - pad * 2) / w, (height - pad * 2) / h);
    const offX = (width - w * scale) / 2;
    const offY = (height - h * scale) / 2;

    const project = (p) => [
      offX + (p.lng - minLng) * kx * scale,
      // SVG は下向きが正なので緯度を反転
      offY + (maxLat - p.lat) * scale,
    ];

    return toSegments(points)
      .filter((s) => s.length >= 2)
      .map((seg) =>
        seg
          .map((p, i) => {
            const [x, y] = project(p);
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ")
      );
  }, [points, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        display: "block",
        background: "var(--surface-2)",
        borderRadius: 10,
        flex: "none",
      }}
      aria-label="ルートの概形"
    >
      {paths ? (
        paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="var(--track)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.9"
          />
        ))
      ) : (
        <text
          x="50%"
          y="54%"
          textAnchor="middle"
          fill="var(--text-faint)"
          fontSize="11"
        >
          —
        </text>
      )}
    </svg>
  );
}
