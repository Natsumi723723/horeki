// MAP — アプリの主役。地図が画面の大部分を占める。
// 重要な操作（歩き始める／一時停止／終了）はすべて画面下部、片手で届く位置に置く。

import { useMemo, useState } from "react";
import MapView from "./MapView.jsx";
import { toSegments, splitDistance, formatClock } from "./geo.js";

export default function MapScreen({ rec, onFinished }) {
  const [follow, setFollow] = useState(true);
  const [confirmStop, setConfirmStop] = useState(false);

  const segments = useMemo(() => toSegments(rec.points), [rec.points]);
  const dist = splitDistance(rec.distance);
  const recording = rec.status === "recording";
  const paused = rec.status === "paused";
  const active = recording || paused;

  const handleStop = async () => {
    setConfirmStop(false);
    const walk = await rec.stop();
    onFinished?.(walk);
  };

  return (
    <div className="map-root">
      <MapView
        segments={segments}
        current={rec.current}
        live={active}
        follow={follow}
        onUserPan={() => setFollow(false)}
      />

      {/* 上：状態表示 */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          right: 12,
          zIndex: 500,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {active && (
          <div
            className="card"
            style={{ padding: "12px 16px", pointerEvents: "auto" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: recording ? "var(--accent)" : "var(--text-faint)",
                  animation: recording ? "pulse 1.6s ease-in-out infinite" : "none",
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  letterSpacing: "0.16em",
                  color: "var(--text-muted)",
                }}
              >
                {recording ? "歩行中" : "一時停止中"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
              <div>
                <span className="stat-value" style={{ fontSize: 30 }}>
                  {dist.value}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    marginLeft: 3,
                  }}
                >
                  {dist.unit}
                </span>
              </div>
              <div>
                <span className="stat-value" style={{ fontSize: 24 }}>
                  {formatClock(rec.elapsed)}
                </span>
              </div>
            </div>
          </div>
        )}

        {rec.error && (
          <div className="banner banner-warn" style={{ pointerEvents: "auto" }}>
            <span>⚠</span>
            <span>{rec.error}</span>
          </div>
        )}

        {!rec.error && rec.gpsWeak && (
          <div className="banner banner-warn" style={{ pointerEvents: "auto" }}>
            <span>📡</span>
            <span>
              GPS信号が弱くなっています
              {active && "（記録は続いています）"}
            </span>
          </div>
        )}

        {!rec.error && !rec.current && (
          <div className="banner" style={{ pointerEvents: "auto" }}>
            <span className="spin" />
            <span>現在地を探しています…</span>
          </div>
        )}
      </div>

      {/* 右下：現在地に戻る */}
      {!follow && rec.current && (
        <button
          className="btn btn-quiet"
          onClick={() => setFollow(true)}
          style={{
            position: "absolute",
            right: 12,
            bottom: active ? 152 : 104,
            zIndex: 500,
            minHeight: 44,
            width: "auto",
            padding: "0 14px",
            fontSize: 14,
          }}
        >
          ⌖ 現在地
        </button>
      )}

      {/* 下：主操作 */}
      <div
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 14,
          zIndex: 500,
        }}
      >
        {!active ? (
          <button
            className="btn btn-primary btn-lg"
            style={{ width: "100%" }}
            onClick={rec.start}
            disabled={!!rec.error}
          >
            歩き始める
          </button>
        ) : (
          <div className="btn-row">
            {recording ? (
              <button className="btn btn-quiet" onClick={rec.pause}>
                ⏸ 一時停止
              </button>
            ) : (
              <button className="btn btn-primary" onClick={rec.resume}>
                ▶ 再開
              </button>
            )}
            <button className="btn btn-accent" onClick={() => setConfirmStop(true)}>
              ■ 終了
            </button>
          </div>
        )}
      </div>

      {confirmStop && (
        <div className="sheet-backdrop" onClick={() => setConfirmStop(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>この歩行を終了しますか</h3>
            <p>
              {splitDistance(rec.distance).value}
              {splitDistance(rec.distance).unit} / {formatClock(rec.elapsed)}
              <br />
              終了すると記録として保存されます。
            </p>
            <div className="btn-row">
              <button
                className="btn btn-quiet"
                onClick={() => setConfirmStop(false)}
              >
                続ける
              </button>
              <button className="btn btn-accent" onClick={handleStop}>
                終了して保存
              </button>
            </div>
            <button
              className="btn btn-quiet"
              style={{
                width: "100%",
                marginTop: 10,
                minHeight: 44,
                fontSize: 14,
                border: "none",
                boxShadow: "none",
                color: "var(--text-faint)",
                background: "transparent",
              }}
              onClick={async () => {
                setConfirmStop(false);
                await rec.discard();
              }}
            >
              保存せずに破棄する
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
