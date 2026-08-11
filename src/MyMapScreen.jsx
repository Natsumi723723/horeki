// MY MAP — これまで歩いた軌跡を1枚の地図に重ねる。
// 歩けば歩くほど線が増えて「自分が実際に歩いた街」が浮かび上がる画面。

import { useEffect, useMemo, useState } from "react";
import MapView from "./MapView.jsx";
import { getAllTracks, getStats } from "./db.js";
import { toSegments, boundsOf, splitDistance, formatDuration } from "./geo.js";

export default function MyMapScreen({ reloadKey, current }) {
  const [tracks, setTracks] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getAllTracks(), getStats()]).then(([ts, st]) => {
      if (!alive) return;
      setTracks(ts);
      setStats(st);
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const segments = useMemo(() => {
    if (!tracks) return [];
    const out = [];
    for (const t of tracks) {
      for (const seg of toSegments(t.points || [])) {
        if (seg.length >= 2) out.push(seg);
      }
    }
    return out;
  }, [tracks]);

  const bounds = useMemo(() => {
    const all = segments.flat();
    return all.length ? boundsOf(all) : null;
  }, [segments]);

  const dist = splitDistance(stats?.totalDistance || 0);
  const empty = stats && stats.count === 0;

  return (
    <div className="map-root">
      <MapView
        segments={segments}
        current={current}
        fitBounds={bounds}
        focus={!bounds && current ? { lat: current.lat, lng: current.lng, zoom: 14 } : null}
      />

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          right: 12,
          zIndex: 500,
        }}
      >
        <div className="card" style={{ padding: "14px 16px" }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              color: "var(--text-faint)",
            }}
          >
            MY WALKING MAP
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 20,
              marginTop: 8,
            }}
          >
            <div>
              <div className="stat-label">累計</div>
              <div>
                <span className="stat-value" style={{ fontSize: 32 }}>
                  {dist.value}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: "var(--text-muted)",
                    marginLeft: 3,
                  }}
                >
                  {dist.unit}
                </span>
              </div>
            </div>
            <div>
              <div className="stat-label">歩行記録</div>
              <div>
                <span className="stat-value" style={{ fontSize: 22 }}>
                  {stats?.count ?? "—"}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    marginLeft: 2,
                  }}
                >
                  回
                </span>
              </div>
            </div>
            <div>
              <div className="stat-label">歩いた日数</div>
              <div>
                <span className="stat-value" style={{ fontSize: 22 }}>
                  {stats?.days ?? "—"}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    marginLeft: 2,
                  }}
                >
                  日
                </span>
              </div>
            </div>
          </div>
          {stats?.totalDuration > 0 && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-faint)",
                marginTop: 8,
                paddingTop: 8,
                borderTop: "1px solid var(--line)",
              }}
            >
              歩いた時間 合計 {formatDuration(stats.totalDuration)}
            </div>
          )}
        </div>
      </div>

      {empty && (
        <div
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 20,
            zIndex: 500,
          }}
        >
          <div className="banner">
            <span>🗺</span>
            <span>
              まだ地図に線がありません。MAP から歩き始めると、ここに軌跡が溜まっていきます。
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
