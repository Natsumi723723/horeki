// RECORD — 過去の歩行記録を新しい順にカードで並べる。

import { useEffect, useState } from "react";
import RouteThumb from "./RouteThumb.jsx";
import { listWalks, getTrack } from "./db.js";
import { formatDate, formatDistance, formatDuration, formatTime } from "./geo.js";

export default function RecordScreen({ reloadKey, onOpen }) {
  const [walks, setWalks] = useState(null);
  const [thumbs, setThumbs] = useState({});

  useEffect(() => {
    let alive = true;
    listWalks().then(async (ws) => {
      if (!alive) return;
      setWalks(ws);
      // サムネ用の点列は一覧表示のあとから順に読む（一覧の表示を待たせない）
      for (const w of ws.slice(0, 40)) {
        const pts = await getTrack(w.id);
        if (!alive) return;
        setThumbs((t) => ({ ...t, [w.id]: pts }));
      }
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  if (walks === null) {
    return (
      <div className="scroll">
        <h1 className="screen-title">記録</h1>
        <div className="empty">読み込んでいます…</div>
      </div>
    );
  }

  return (
    <div className="scroll">
      <h1 className="screen-title">記録</h1>
      {walks.length > 0 && (
        <p className="screen-sub">{walks.length} 件の街歩き</p>
      )}

      {walks.length === 0 ? (
        <div className="empty">
          <span className="empty-mark">歩</span>
          まだ記録がありません。
          <br />
          MAP から「歩き始める」を押すと、
          <br />
          ここに歩いた記録が残ります。
        </div>
      ) : (
        walks.map((w) => (
          <button
            key={w.id}
            className="card card-tap"
            onClick={() => onOpen(w.id)}
          >
            <div
              style={{
                display: "flex",
                gap: 14,
                padding: 14,
                alignItems: "center",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {formatDate(w.startedAt)}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 12,
                    marginTop: 4,
                  }}
                >
                  <span className="stat-value" style={{ fontSize: 26 }}>
                    {formatDistance(w.distance)}
                  </span>
                  <span
                    className="stat-value"
                    style={{ fontSize: 15, color: "var(--text-muted)" }}
                  >
                    {formatDuration(w.duration)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-faint)",
                    marginTop: 4,
                  }}
                >
                  {formatTime(w.startedAt)} 〜 {formatTime(w.endedAt)}
                </div>
              </div>
              <RouteThumb points={thumbs[w.id] || []} width={84} height={84} />
            </div>
          </button>
        ))
      )}
    </div>
  );
}
