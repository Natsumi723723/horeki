// 地理計算・GPS フィルタ・表示フォーマット。
// ここは副作用ゼロの純関数だけを置く（テストしやすさのため）。

const EARTH_R = 6371008.8; // WGS84 平均半径 (m)

const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * 2点間の大円距離（メートル）。緯度経度の単純な差分ではなく
 * 球面上の距離として計算する。
 */
export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 進行方向（度・北が0）。現在地マーカーの向きに使う。 */
export function bearing(lat1, lng1, lat2, lng2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// ── GPS 品質のしきい値 ────────────────────────────────
// 徒歩用途に合わせた値。高頻度に取り続けず、明らかな異常値だけを弾く。
export const GPS = {
  /** これより精度(誤差半径 m)が悪い測位は採用しない */
  MAX_ACCURACY: 50,
  /** これより精度が悪い状態が続いたら「GPS が弱い」と表示 */
  WEAK_ACCURACY: 35,
  /** 徒歩の上限速度 (m/s)。約 29km/h。これを超える移動は外れ値 */
  MAX_SPEED: 8,
  /** これ未満の移動は GPS ノイズとみなし、距離に加算しない (m) */
  MIN_MOVE: 4,
  /** 一度に飛べる最大距離 (m)。これを超えたら無条件に外れ値 */
  MAX_JUMP: 300,
  /** この秒数だけ測位が来なければ「GPS が弱い」と表示 (ms) */
  STALE_MS: 20000,
  /** この時間 GPS が切れたら軌跡を分断する（線で結ばない） (ms) */
  GAP_MS: 60000,
  /** 測位を処理する最小間隔 (ms)。取りすぎを抑えてバッテリーを守る */
  MIN_INTERVAL_MS: 3000,
  /** 連続でこの回数はじいたら、GPS が本当に移動したとみなして再同期する */
  RESYNC_AFTER_REJECTS: 6,
};

/**
 * 1件の測位を採用するか判定する純関数。
 * @param {object|null} prev 直前に「採用した」点 {lat,lng,t,acc}
 * @param {object} fix 新しい測位 {lat,lng,t,acc}
 * @param {number|null} lastFixT 直前に「受信した」測位の時刻。
 *   採用/不採用に関わらず更新される値を渡すこと。
 *   立ち止まっているだけの状態を「GPS が切れた」と誤判定しないために必要。
 * @returns {{action:'accept'|'hold'|'reject', distance:number, gap:boolean, reason?:string}}
 *   accept … 軌跡に追加する / hold … 静止とみなし追加しない / reject … 外れ値として捨てる
 */
export function evaluateFix(prev, fix, lastFixT = null) {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) {
    return { action: "reject", distance: 0, gap: false, reason: "invalid" };
  }
  // 精度が悪すぎる測位は、そもそも信用しない
  if (Number.isFinite(fix.acc) && fix.acc > GPS.MAX_ACCURACY) {
    return { action: "reject", distance: 0, gap: false, reason: "accuracy" };
  }
  if (!prev) return { action: "accept", distance: 0, gap: false };

  const dt = (fix.t - prev.t) / 1000;
  if (dt <= 0) {
    return { action: "reject", distance: 0, gap: false, reason: "time" };
  }

  const d = haversine(prev.lat, prev.lng, fix.lat, fix.lng);
  // 「測位が途切れていた」かどうかは、受信の途切れで判定する。
  // 採用点の間隔で判定すると、長く立ち止まっただけで軌跡が分断されてしまう。
  const gap =
    lastFixT != null ? fix.t - lastFixT >= GPS.GAP_MS : fix.t - prev.t >= GPS.GAP_MS;

  // 数百m 突然ジャンプ / 短時間で異常な速度 → 外れ値。
  // ただし GPS が長時間切れていた場合は、実際に移動している可能性が高いので
  // 速度judgeは行わず「軌跡を分断して」採用する。
  if (!gap) {
    if (d > GPS.MAX_JUMP) {
      return { action: "reject", distance: 0, gap: false, reason: "jump" };
    }
    if (d / dt > GPS.MAX_SPEED) {
      return { action: "reject", distance: 0, gap: false, reason: "speed" };
    }
  }

  // 微小な揺れは動いていないものとして扱う。
  // 精度が悪いときほど揺れ幅が大きいので、しきい値を精度に連動させる。
  const noiseFloor = Math.max(GPS.MIN_MOVE, (fix.acc || 0) * 0.5);
  if (!gap && d < noiseFloor) {
    return { action: "hold", distance: 0, gap: false, reason: "noise" };
  }

  return { action: "accept", distance: gap ? 0 : d, gap };
}

/**
 * 点列を、軌跡が途切れた箇所（brk フラグ）で区切ってセグメントに分ける。
 * 地図上で「飛んだ区間を線で結ばない」ために使う。
 */
export function toSegments(points) {
  const segs = [];
  let cur = [];
  for (const p of points) {
    if (p.brk && cur.length) {
      segs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  return segs.filter((s) => s.length > 0);
}

/** 点列の総距離 (m)。分断された区間はまたがずに計算する。 */
export function totalDistance(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].brk) continue;
    sum += haversine(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    );
  }
  return sum;
}

/**
 * 累積標高（上りの合計・m）。GPS の標高はノイズが大きいので
 * threshold 未満の変動は無視する。標高が取れない端末では 0 を返す。
 */
export function elevationGain(points, threshold = 4) {
  let gain = 0;
  let base = null;
  for (const p of points) {
    if (!Number.isFinite(p.alt)) continue;
    if (base === null) {
      base = p.alt;
      continue;
    }
    const diff = p.alt - base;
    if (diff > threshold) {
      gain += diff;
      base = p.alt;
    } else if (diff < -threshold) {
      base = p.alt;
    }
  }
  return gain;
}

/** 点列を包む矩形。地図のフィットに使う。 */
export function boundsOf(points) {
  if (!points.length) return null;
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
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

// ── 表示フォーマット ──────────────────────────────────

/** 8700 → "8.7 km" / 650 → "650 m" */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return "— km";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** 距離の数値と単位を分けて返す（大きく見せたいとき用） */
export function splitDistance(m) {
  if (!Number.isFinite(m)) return { value: "—", unit: "km" };
  if (m < 1000) return { value: String(Math.round(m)), unit: "m" };
  return { value: (m / 1000).toFixed(1), unit: "km" };
}

/** 8040000 → "2時間14分" */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分`;
  return `${s}秒`;
}

/** 記録中の経過時間表示 "1:23:45" / "23:45" */
export function formatClock(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatTime(ts) {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** ローカル日付キー "2026-08-11"。歩いた日数のカウントに使う。 */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 平均速度 km/h */
export function averageSpeed(distanceM, durationMs) {
  if (!durationMs || durationMs <= 0) return 0;
  return distanceM / 1000 / (durationMs / 3600000);
}

export function formatSpeed(kmh) {
  if (!Number.isFinite(kmh) || kmh <= 0) return "— km/h";
  return `${kmh.toFixed(1)} km/h`;
}
