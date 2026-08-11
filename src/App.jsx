import { useCallback, useState } from "react";
import MapScreen from "./MapScreen.jsx";
import RecordScreen from "./RecordScreen.jsx";
import ExploreScreen from "./ExploreScreen.jsx";
import MyMapScreen from "./MyMapScreen.jsx";
import WalkDetail from "./WalkDetail.jsx";
import { useRecorder } from "./useRecorder.js";
import { formatDistance, totalDistance } from "./geo.js";

const TABS = [
  { key: "map", icon: "◎", label: "MAP", aria: "地図と歩行記録" },
  { key: "record", icon: "▤", label: "記録", aria: "過去の歩行記録" },
  { key: "explore", icon: "⌖", label: "まわり", aria: "周辺のスポット" },
  { key: "mymap", icon: "▨", label: "MY MAP", aria: "これまで歩いた地図" },
];

export default function App() {
  const rec = useRecorder();
  const [tab, setTab] = useState("map");
  const [detailId, setDetailId] = useState(null);
  // 記録が増減したら一覧・MY MAP を読み直させるためのカウンタ
  const [reloadKey, setReloadKey] = useState(0);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);

  const handleFinished = useCallback(
    (walk) => {
      bump();
      if (walk) {
        setDetailId(walk.id);
        setTab("record");
      }
    },
    [bump]
  );

  return (
    <div className="app">
      <div className="screen">
        {detailId ? (
          <WalkDetail
            walkId={detailId}
            onBack={() => setDetailId(null)}
            onDeleted={() => {
              setDetailId(null);
              bump();
            }}
          />
        ) : tab === "map" ? (
          <MapScreen rec={rec} onFinished={handleFinished} />
        ) : tab === "record" ? (
          <RecordScreen reloadKey={reloadKey} onOpen={setDetailId} />
        ) : tab === "explore" ? (
          <ExploreScreen current={rec.current} />
        ) : (
          <MyMapScreen reloadKey={reloadKey} current={rec.current} />
        )}
      </div>

      <nav className="tabbar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={!detailId && tab === t.key}
            aria-label={t.aria}
            className="tab"
            onClick={() => {
              setDetailId(null);
              setTab(t.key);
            }}
          >
            <span className="tab-icon" aria-hidden="true">
              {t.icon}
            </span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* 前回の記録が中断されたまま残っている場合の復帰 */}
      {rec.pending && <RecoverySheet rec={rec} onSaved={bump} />}
    </div>
  );
}

function RecoverySheet({ rec, onSaved }) {
  const pts = rec.pending.points || [];
  const dist = rec.pending.distance ?? totalDistance(pts);
  return (
    <div className="sheet-backdrop">
      <div className="sheet">
        <h3>中断された記録があります</h3>
        <p>
          前回の歩行が終了されないまま残っています。
          <br />
          {formatDistance(dist)} ／ {pts.length} 点
          <br />
          このまま歩き続けることも、ここまでを記録として保存することもできます。
        </p>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={rec.recoverResume}>
            記録を再開
          </button>
          <button
            className="btn btn-quiet"
            onClick={async () => {
              await rec.recoverSave();
              onSaved();
            }}
          >
            保存して終了
          </button>
        </div>
        <button
          className="btn"
          style={{
            width: "100%",
            marginTop: 8,
            minHeight: 44,
            fontSize: 14,
            color: "var(--text-faint)",
          }}
          onClick={rec.recoverDiscard}
        >
          破棄する
        </button>
      </div>
    </div>
  );
}
