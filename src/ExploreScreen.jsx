// EXPLORE — 現在地の周りにある「歩いて見に行ける」史跡・寺社・文化施設。
// 飲食店などの一般的なスポットは意図的に出さない。歩いている途中で
// 歴史や文化に出会うことがこの画面の目的。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./MapView.jsx";
import { CATEGORIES, fetchNearbySpots, clearSpotsCache } from "./spots.js";
import { formatDistance, boundsOf, formatTime, formatDate } from "./geo.js";
import { addCheckin, lastVisitBySpot } from "./db.js";
import SpotImage from "./SpotImage.jsx";

const RADIUS_OPTIONS = [
  { label: "500m", value: 500 },
  { label: "1km", value: 1000 },
  { label: "2km", value: 2000 },
];

export default function ExploreScreen({ current, activeWalkId, onCheckin }) {
  const [spots, setSpots] = useState([]);
  const [source, setSource] = useState(null);
  // 取得したときの現在地。地図の表示範囲はこれを基準に固定する
  // （毎秒動く current を使うと、地図が動かせなくなる）
  const [origin, setOrigin] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(null); // null = すべて
  const [radius, setRadius] = useState(1000);
  const [view, setView] = useState("list"); // list | map
  const [selected, setSelected] = useState(null);
  const [visits, setVisits] = useState(new Map()); // spotId → 最終訪問時刻
  const abortRef = useRef(null);
  const fetchedFor = useRef(null);

  useEffect(() => {
    lastVisitBySpot().then(setVisits);
  }, []);

  /** 意図的にチェックインする。記録中なら、その日の歩行記録に紐づく。 */
  const checkin = useCallback(
    async (spot) => {
      const at = Date.now();
      await addCheckin(spot, { walkId: activeWalkId || null, at });
      setVisits((m) => new Map(m).set(spot.id, at));
      onCheckin?.();
    },
    [activeWalkId, onCheckin]
  );

  const load = useCallback(
    async (lat, lng, r, { fresh = false } = {}) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      if (fresh) clearSpotsCache(); // 手動更新のときはキャッシュに邪魔をさせない
      setLoading(true);
      try {
        // 公開サーバが詰まっていることがあるので、待ちすぎない
        const res = await fetchNearbySpots(lat, lng, {
          radius: r,
          signal: ac.signal,
          timeoutMs: 10000,
        });
        if (ac.signal.aborted) return;
        setSpots(res.spots || []);
        setSource(res.source);
        setError(res.error || null);
        setOrigin({ lat, lng });
      } catch (e) {
        if (e?.name === "AbortError") return;
        setError("スポット情報を取得できませんでした。");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    []
  );

  // 現在地が取れたら一度だけ自動取得。以後は「更新」ボタンか半径変更で取り直す。
  useEffect(() => {
    if (!current) return;
    const key = `${radius}`;
    if (fetchedFor.current === key) return;
    fetchedFor.current = key;
    load(current.lat, current.lng, radius);
  }, [current, radius, load]);

  // 画面を離れたら取得を打ち切る。打ち切ったぶんは「取得済み」とみなさず、
  // 戻ってきたときに取り直させる（中断したまま読み込み中で固まるのを防ぐ）。
  useEffect(
    () => () => {
      abortRef.current?.abort();
      fetchedFor.current = null;
    },
    []
  );

  const visible = useMemo(
    () => (filter ? spots.filter((s) => s.category === filter) : spots),
    [spots, filter]
  );

  const pins = useMemo(
    () =>
      visible.map((s) => ({
        ...s,
        icon: CATEGORIES[s.category]?.icon || "📍",
      })),
    [visible]
  );

  // 地図表示は「取得時の現在地＋出ているスポット」が全部入る範囲に合わせる。
  // 固定ズームだと、遠くのサンプルデータのときに何も見えなくなる。
  const mapBounds = useMemo(() => {
    if (!origin) return null;
    const pts = [origin, ...pins];
    return pts.length > 1 ? boundsOf(pts) : null;
  }, [origin, pins]);

  // 実際に結果に出ているカテゴリだけをチップに出す
  const availableCats = useMemo(() => {
    const set = new Set(spots.map((s) => s.category));
    return Object.values(CATEGORIES).filter((c) => set.has(c.key));
  }, [spots]);

  if (!current) {
    return (
      <div className="scroll">
        <h1 className="screen-title">まわりを見る</h1>
        <div className="empty">
          <span className="empty-mark">探</span>
          現在地を探しています。
          <br />
          位置情報が許可されているか確認してください。
        </div>
      </div>
    );
  }

  const header = (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <h1 className="screen-title" style={{ margin: "4px 0 8px" }}>
          まわりを見る
        </h1>
        <button
          className="chip"
          onClick={() => setView(view === "list" ? "map" : "list")}
          style={{ marginBottom: 4 }}
        >
          {view === "list" ? "🗺 地図で見る" : "☰ 一覧で見る"}
        </button>
      </div>

      <div className="chips">
        {RADIUS_OPTIONS.map((o) => (
          <button
            key={o.value}
            className="chip"
            aria-pressed={radius === o.value}
            onClick={() => {
              setRadius(o.value);
              fetchedFor.current = `${o.value}`;
              load(current.lat, current.lng, o.value);
            }}
          >
            {o.label}以内
          </button>
        ))}
        <button
          className="chip"
          onClick={() => load(current.lat, current.lng, radius, { fresh: true })}
        >
          ↻ 更新
        </button>
      </div>

      {availableCats.length > 1 && (
        <div className="chips">
          <button
            className="chip"
            aria-pressed={filter === null}
            onClick={() => setFilter(null)}
          >
            すべて
          </button>
          {availableCats.map((c) => (
            <button
              key={c.key}
              className="chip"
              aria-pressed={filter === c.key}
              onClick={() => setFilter(filter === c.key ? null : c.key)}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="banner" style={{ marginBottom: 12 }}>
          <span className="spin" />
          <span>周辺のスポットを探しています…</span>
        </div>
      )}

      {!loading && (error || source === "sample") && (
        <div
          className={`banner ${error ? "banner-warn" : ""}`}
          style={{ marginBottom: 12 }}
        >
          <span>{error ? "⚠" : "ℹ"}</span>
          <span>
            {error}
            {/* 取得に失敗したときは必ずサンプル表示だと伝える。
                伝えないと、遠くのスポットが出ている理由が分からない */}
            {source === "sample" && (
              <>
                {error ? <br /> : null}
                サンプルデータを表示しています。
              </>
            )}
          </span>
        </div>
      )}
    </>
  );

  if (view === "map") {
    return (
      <div className="map-root">
        <MapView
          spots={pins}
          current={current}
          fitBounds={mapBounds}
          focus={
            !mapBounds && origin
              ? { lat: origin.lat, lng: origin.lng, zoom: 15 }
              : null
          }
          onSpotClick={setSelected}
        />
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
            alignItems: "flex-start",
          }}
        >
          <button
            className="btn btn-quiet btn-sm"
            onClick={() => setView("list")}
            style={{ width: "auto", padding: "0 14px" }}
          >
            ☰ 一覧で見る
          </button>
          {source === "sample" && (
            <div className="banner" style={{ alignSelf: "stretch" }}>
              <span>ℹ</span>
              <span>サンプルデータを表示しています。</span>
            </div>
          )}
          {loading && (
            <div className="banner" style={{ alignSelf: "stretch" }}>
              <span className="spin" />
              <span>周辺のスポットを探しています…</span>
            </div>
          )}
        </div>
        {selected && (
          <div className="sheet-backdrop" onClick={() => setSelected(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <SpotBody
                spot={selected}
                visitedAt={visits.get(selected.id)}
                onCheckin={checkin}
                withImage
              />
              <button
                className="btn btn-quiet"
                style={{ width: "100%", marginTop: 16 }}
                onClick={() => setSelected(null)}
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="scroll">
      {header}

      {!loading && visible.length === 0 && !error && (
        <div className="empty">
          <span className="empty-mark">無</span>
          この範囲には史跡・寺社・文化施設が
          <br />
          見つかりませんでした。
          <br />
          範囲を広げてみてください。
        </div>
      )}

      {visible.map((s) => (
        <div className="card" key={s.id} style={{ padding: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <SpotImage spot={s} size={72} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <SpotBody spot={s} visitedAt={visits.get(s.id)} onCheckin={checkin} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SpotBody({ spot, visitedAt, onCheckin, withImage = false }) {
  const cat = CATEGORIES[spot.category];
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    setSaving(true);
    try {
      await onCheckin?.(spot);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {withImage && (
        <div style={{ marginBottom: 12 }}>
          <SpotImage spot={spot} size={140} rounded={12} />
        </div>
      )}
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: "0.04em",
        }}
      >
        {spot.name}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-faint)",
          marginTop: 3,
          display: "flex",
          gap: 10,
        }}
      >
        <span>
          {cat?.icon} {cat?.label || "スポット"}
        </span>
        {Number.isFinite(spot.distance) && (
          <span>現在地から {formatDistance(spot.distance)}</span>
        )}
      </div>
      {spot.description && (
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            margin: "8px 0 0",
            lineHeight: 1.8,
          }}
        >
          {spot.description}
        </p>
      )}

      {visitedAt && (
        <div
          style={{
            fontSize: 12,
            color: "var(--accent)",
            marginTop: 8,
            letterSpacing: "0.04em",
          }}
        >
          ✓ {formatDate(visitedAt)} {formatTime(visitedAt)} に訪問
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: 10,
        }}
      >
        {onCheckin && (
          <button
            className="btn btn-quiet btn-sm"
            onClick={handle}
            disabled={saving}
            style={{
              width: "auto",
              padding: "0 16px",
              flex: "none",
              whiteSpace: "nowrap",
            }}
          >
            {saving ? "…" : visitedAt ? "また来た" : "✓ チェックイン"}
          </button>
        )}
        {spot.wikipediaUrl && (
          <a
            href={spot.wikipediaUrl}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              fontSize: 12,
              color: "var(--accent)",
              textDecorationThickness: "1px",
              whiteSpace: "nowrap",
              flex: "none",
            }}
          >
            詳しく読む ↗
          </a>
        )}
      </div>
    </>
  );
}
