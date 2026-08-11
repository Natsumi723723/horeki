// RECORD — 過去の歩行記録を新しい順にカードで並べる。

import { useEffect, useState } from "react";
import RouteThumb from "./RouteThumb.jsx";
import { listWalks, getTrack, clearDemoData } from "./db.js";
import { formatDate, formatDistance, formatDuration, formatTime } from "./geo.js";

export default function RecordScreen({ reloadKey, onOpen, onChanged }) {
  const [walks, setWalks] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [busy, setBusy] = useState(false);

  const seedDemo = async () => {
    setBusy(true);
    try {
      // デモは普段使わないので、必要になったときだけ読み込む
      const { seedDemoData } = await import("./demoData.js");
      await seedDemoData();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const removeDemo = async () => {
    setBusy(true);
    try {
      await clearDemoData();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

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

  const hasDemo = !!walks?.some((w) => w.demo);

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

      {hasDemo && (
        <div
          className="banner"
          style={{ marginBottom: 12, justifyContent: "space-between" }}
        >
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>🎞</span>
            <span>デモデータが入っています</span>
          </span>
          <button
            onClick={removeDemo}
            disabled={busy}
            style={{
              color: "var(--accent)",
              fontSize: 13,
              padding: "6px 4px",
              minHeight: 32,
              flex: "none",
            }}
          >
            {busy ? "…" : "消す"}
          </button>
        </div>
      )}

      {walks.length === 0 ? (
        <div className="empty">
          <span className="empty-mark">歩</span>
          まだ記録がありません。
          <br />
          MAP から「歩き始める」を押すと、
          <br />
          ここに歩いた記録が残ります。
          <div style={{ marginTop: 28 }}>
            <button
              className="btn btn-quiet"
              onClick={seedDemo}
              disabled={busy}
              style={{ width: "100%" }}
            >
              {busy ? "作成中…" : "デモデータを入れて見てみる"}
            </button>
            <p
              style={{
                fontSize: 12,
                color: "var(--text-faint)",
                marginTop: 10,
                lineHeight: 1.8,
              }}
            >
              歩かなくても、記録・MY MAP・チェックインが
              <br />
              どう見えるか試せます。あとからまとめて消せます。
            </p>
          </div>
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
                  {w.demo && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        letterSpacing: "0.1em",
                        color: "var(--text-faint)",
                        border: "1px solid var(--line-strong)",
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      デモ
                    </span>
                  )}
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
