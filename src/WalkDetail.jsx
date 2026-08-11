// 歩行記録の詳細。地図に実際のルートを描き、その下に数値を並べる。

import { useEffect, useMemo, useState } from "react";
import MapView from "./MapView.jsx";
import { getWalk, getTrack, deleteWalk } from "./db.js";
import {
  toSegments,
  boundsOf,
  formatDate,
  formatDistance,
  formatDuration,
  formatTime,
  formatSpeed,
  averageSpeed,
} from "./geo.js";

function Stat({ label, value }) {
  return (
    <div style={{ flex: "1 1 33%", minWidth: 92, padding: "10px 0" }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 20, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

export default function WalkDetail({ walkId, onBack, onDeleted }) {
  const [walk, setWalk] = useState(null);
  const [points, setPoints] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([getWalk(walkId), getTrack(walkId)]).then(([w, pts]) => {
      if (!alive) return;
      setWalk(w);
      setPoints(pts);
    });
    return () => {
      alive = false;
    };
  }, [walkId]);

  const segments = useMemo(() => toSegments(points), [points]);
  const bounds = useMemo(() => boundsOf(points), [points]);
  // 標高0mと「そもそも取れなかった」は別物なので区別して表示する
  const hasAltitude = useMemo(
    () => points.some((p) => Number.isFinite(p.alt)),
    [points]
  );

  if (!walk) {
    return (
      <div className="scroll">
        <div className="empty">読み込んでいます…</div>
      </div>
    );
  }

  const speed = averageSpeed(walk.distance, walk.duration);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "8px 8px 8px 4px",
          borderBottom: "1px solid var(--line)",
          background: "var(--surface)",
          flex: "none",
        }}
      >
        <button
          onClick={onBack}
          style={{
            minHeight: 44,
            padding: "0 12px",
            fontSize: 15,
            color: "var(--text-muted)",
          }}
        >
          ‹ 記録
        </button>
        <div
          style={{
            flex: 1,
            fontFamily: "var(--font-serif)",
            fontSize: 15,
            letterSpacing: "0.06em",
            textAlign: "center",
          }}
        >
          {formatDate(walk.startedAt)}の街歩き
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          style={{
            minHeight: 44,
            padding: "0 12px",
            fontSize: 14,
            color: "var(--text-faint)",
          }}
        >
          削除
        </button>
      </div>

      <div style={{ flex: "none", height: "42%", minHeight: 200, position: "relative" }}>
        <MapView segments={segments} fitBounds={bounds} />
      </div>

      <div className="scroll" style={{ flex: 1, paddingTop: 14 }}>
        <div className="card" style={{ padding: "6px 16px 10px" }}>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            <Stat label="距離" value={formatDistance(walk.distance)} />
            <Stat label="歩行時間" value={formatDuration(walk.duration)} />
            <Stat label="平均速度" value={formatSpeed(speed)} />
            <Stat label="開始" value={formatTime(walk.startedAt)} />
            <Stat label="終了" value={formatTime(walk.endedAt)} />
            <Stat
              label="累積標高"
              value={
                !hasAltitude
                  ? "—"
                  : walk.elevGain > 0
                    ? `${Math.round(walk.elevGain)} m`
                    : "ほぼ平坦"
              }
            />
          </div>
        </div>
        <p
          style={{
            fontSize: 12,
            color: "var(--text-faint)",
            marginTop: 12,
            lineHeight: 1.9,
          }}
        >
          GPS取得点数 {walk.pointCount} 点
          {hasAltitude ? "" : "／この端末では標高が取得できませんでした"}
        </p>
      </div>

      {confirmDelete && (
        <div className="sheet-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>この記録を削除しますか</h3>
            <p>削除すると元に戻せません。</p>
            <div className="btn-row">
              <button
                className="btn btn-quiet"
                onClick={() => setConfirmDelete(false)}
              >
                やめる
              </button>
              <button
                className="btn btn-accent"
                onClick={async () => {
                  await deleteWalk(walkId);
                  setConfirmDelete(false);
                  onDeleted?.();
                }}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
