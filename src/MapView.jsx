// Leaflet を React から扱うための薄いラッパー。
// 地図タイルは OpenStreetMap（API キー不要・無料）。和の質感は CSS の
// タイルフィルタで出しているので、ここでは色をいじらない。

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * @param {object[][]} segments 描画する軌跡（途切れごとに分かれた配列の配列）
 * @param {object|null} current 現在地 {lat,lng,acc,heading}
 * @param {object[]} spots 表示するスポット
 * @param {boolean} live 記録中か（線の色が変わる）
 * @param {boolean} follow 現在地を自動で追いかけるか
 * @param {[number,number][]|null} fitBounds この値が変わったら範囲にフィットする
 * @param {object|null} focus {lat,lng,zoom} この値が変わったらそこへ移動する
 */
export default function MapView({
  segments = [],
  current = null,
  spots = [],
  live = false,
  follow = false,
  fitBounds = null,
  focus = null,
  interactive = true,
  onUserPan,
  onSpotClick,
  className = "",
}) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const trackLayer = useRef(null);
  const spotLayer = useRef(null);
  const meMarker = useRef(null);
  const accCircle = useRef(null);
  const lastFocus = useRef(null);
  const followRef = useRef(follow);
  const onUserPanRef = useRef(onUserPan);
  const onSpotClickRef = useRef(onSpotClick);

  followRef.current = follow;
  onUserPanRef.current = onUserPan;
  onSpotClickRef.current = onSpotClick;

  // ── 地図の生成（一度だけ） ──
  useEffect(() => {
    const map = L.map(boxRef.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: interactive,
      touchZoom: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      tap: interactive,
      preferCanvas: true, // 点数が多い軌跡でも軽い
    });
    map.setView([35.6812, 139.7671], 14); // 初期値：東京駅。すぐ現在地に移る
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: ATTRIBUTION,
      crossOrigin: true,
    }).addTo(map);
    if (interactive) L.control.zoom({ position: "topright" }).addTo(map);

    trackLayer.current = L.layerGroup().addTo(map);
    spotLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // ユーザーが自分で地図を動かしたら追従をやめる
    const onDrag = () => onUserPanRef.current?.();
    map.on("dragstart", onDrag);

    // タブ切り替え直後などサイズが確定していないことがあるので測り直す
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(boxRef.current);
    const t = setTimeout(() => map.invalidateSize(), 60);

    return () => {
      clearTimeout(t);
      ro.disconnect();
      map.off("dragstart", onDrag);
      map.remove();
      mapRef.current = null;
      // 破棄した地図に属していたレイヤの参照を残さない。
      // 残すと、貼り直した地図に現在地マーカーが二度と載らなくなる。
      meMarker.current = null;
      accCircle.current = null;
      trackLayer.current = null;
      spotLayer.current = null;
      lastFocus.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 軌跡の描画 ──
  useEffect(() => {
    const layer = trackLayer.current;
    if (!layer) return;
    layer.clearLayers();
    const color = live ? cssVar("--track-live", "#a64b3c") : cssVar("--track", "#36566f");
    for (const seg of segments) {
      if (!seg || seg.length < 2) continue;
      L.polyline(
        seg.map((p) => [p.lat, p.lng]),
        { color, weight: 5, opacity: 0.85, lineJoin: "round", lineCap: "round" }
      ).addTo(layer);
    }
    // 記録の始点・終点（記録中でないときだけ。地図が煩くならないように）
    if (!live && segments.length) {
      const first = segments[0][0];
      const lastSeg = segments[segments.length - 1];
      const last = lastSeg[lastSeg.length - 1];
      if (first) {
        L.circleMarker([first.lat, first.lng], {
          radius: 6,
          color: "#fff",
          weight: 2,
          fillColor: cssVar("--track", "#36566f"),
          fillOpacity: 1,
        }).addTo(layer);
      }
      if (last && last !== first) {
        L.circleMarker([last.lat, last.lng], {
          radius: 6,
          color: "#fff",
          weight: 2,
          fillColor: cssVar("--accent", "#a64b3c"),
          fillOpacity: 1,
        }).addTo(layer);
      }
    }
  }, [segments, live]);

  // ── 現在地 ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!current) {
      meMarker.current?.remove();
      accCircle.current?.remove();
      meMarker.current = null;
      accCircle.current = null;
      return;
    }
    const pos = [current.lat, current.lng];
    const heading = Number.isFinite(current.heading) ? current.heading : null;
    const html = `<div class="me-wrap">${
      heading != null
        ? `<div class="me-heading" style="transform:rotate(${heading}deg)"></div>`
        : ""
    }<div class="me-dot"></div></div>`;

    if (!meMarker.current) {
      meMarker.current = L.marker(pos, {
        icon: L.divIcon({ className: "", html, iconSize: [20, 20], iconAnchor: [10, 10] }),
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(map);
    } else {
      meMarker.current.setLatLng(pos);
      meMarker.current.setIcon(
        L.divIcon({ className: "", html, iconSize: [20, 20], iconAnchor: [10, 10] })
      );
    }

    // 精度の円。誤差が大きいときだけ出す（普段は邪魔なので）
    if (Number.isFinite(current.acc) && current.acc > 20) {
      if (!accCircle.current) {
        accCircle.current = L.circle(pos, {
          radius: current.acc,
          color: cssVar("--accent", "#a64b3c"),
          weight: 1,
          opacity: 0.4,
          fillOpacity: 0.06,
        }).addTo(map);
      } else {
        accCircle.current.setLatLng(pos).setRadius(current.acc);
      }
    } else {
      accCircle.current?.remove();
      accCircle.current = null;
    }

    if (followRef.current) {
      map.setView(pos, Math.max(map.getZoom(), 16), { animate: true, duration: 0.4 });
    }
  }, [current]);

  // ── スポットのピン ──
  useEffect(() => {
    const layer = spotLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const s of spots) {
      const m = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="spot-pin">${s.icon || "📍"}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        title: s.name,
      }).addTo(layer);
      m.on("click", () => onSpotClickRef.current?.(s));
    }
  }, [spots]);

  // ── 範囲へのフィット ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitBounds) return;
    map.fitBounds(fitBounds, { padding: [36, 36], maxZoom: 17 });
  }, [fitBounds]);

  // ── 指定地点へ移動 ──
  // focus は呼び出し側でオブジェクトが作り直されがちなので、
  // 中身が本当に変わったときだけ動かす。毎回動かすと地図を手で動かせなくなる。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const key = `${focus.lat},${focus.lng},${focus.zoom || 17}`;
    if (lastFocus.current === key) return;
    lastFocus.current = key;
    map.setView([focus.lat, focus.lng], focus.zoom || 17, { animate: true });
  }, [focus]);

  return <div ref={boxRef} className={`map-box ${className}`} />;
}
