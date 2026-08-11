// スポットの写真。
// - タグに画像があればそれを出す
// - 無ければ Wikipedia から探す（画面に入ったときだけ／キーは不要）
// - 見つからない・読み込めない場合はカテゴリの印を出す。枠のサイズは変えない
//   （写真の有無でカードの高さが動くと一覧が読みにくくなるため）

import { useEffect, useRef, useState } from "react";
import { CATEGORIES, fetchSpotMedia } from "./spots.js";

export default function SpotImage({ spot, size = 72, rounded = 10 }) {
  const [url, setUrl] = useState(spot?.imageUrl || null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const boxRef = useRef(null);

  // 画面に入るまで取りに行かない（一覧をスクロールしただけで大量に叩かないため）
  useEffect(() => {
    const el = boxRef.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || url || failed || !spot) return;
    let alive = true;
    const ac = new AbortController();
    fetchSpotMedia(spot, { signal: ac.signal })
      .then((m) => {
        if (!alive) return;
        if (m?.imageUrl) setUrl(m.imageUrl);
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [visible, url, failed, spot]);

  const cat = CATEGORIES[spot?.category];

  return (
    <div
      ref={boxRef}
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: rounded,
        overflow: "hidden",
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={spot?.name || ""}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{ fontSize: Math.round(size * 0.36), opacity: 0.45 }}
        >
          {cat?.icon || "📍"}
        </span>
      )}
    </div>
  );
}
