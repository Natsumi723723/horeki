// 距離計算とGPSフィルタのテスト。ここが壊れると記録そのものが信用できなくなる。
import test from "node:test";
import assert from "node:assert/strict";
import {
  haversine,
  bearing,
  evaluateFix,
  toSegments,
  totalDistance,
  elevationGain,
  boundsOf,
  formatDistance,
  splitDistance,
  formatDuration,
  formatClock,
  averageSpeed,
  dayKey,
  GPS,
} from "../src/geo.js";

// ── 距離 ──────────────────────────────────────────
test("緯度1度の距離は約111.2km", () => {
  const d = haversine(35, 135, 36, 135);
  assert.ok(Math.abs(d - 111194.9) < 1, `got ${d}`);
});

test("北緯35度での経度1度は緯度1度より短い", () => {
  const lat = haversine(35, 135, 36, 135);
  const lng = haversine(35, 135, 35, 136);
  assert.ok(lng < lat);
  assert.ok(Math.abs(lng - 91_000) < 1500, `got ${lng}`);
});

test("同じ点どうしの距離は0", () => {
  assert.equal(haversine(35.6812, 139.7671, 35.6812, 139.7671), 0);
});

test("真北への方位は0度", () => {
  assert.ok(Math.abs(bearing(35, 135, 36, 135)) < 0.001);
});

// ── GPSフィルタ ───────────────────────────────────
const at = (lat, lng, t, acc = 8) => ({ lat, lng, t, acc });
// 東京駅からおよそ north m / east m 動いた点
const moved = (north, east, t, acc = 8) =>
  at(35.6812 + north / 111320, 139.7671 + east / 90600, t, acc);

test("最初の測位は必ず採用される", () => {
  const v = evaluateFix(null, at(35.6812, 139.7671, 1000));
  assert.equal(v.action, "accept");
  assert.equal(v.distance, 0);
});

test("精度が悪すぎる測位は捨てる", () => {
  const v = evaluateFix(null, at(35.6812, 139.7671, 1000, GPS.MAX_ACCURACY + 1));
  assert.equal(v.action, "reject");
  assert.equal(v.reason, "accuracy");
});

test("数百m突然ジャンプした点は外れ値として捨てる", () => {
  const prev = at(35.6812, 139.7671, 1000);
  const v = evaluateFix(prev, moved(0, 800, 6000), 1000);
  assert.equal(v.action, "reject");
  assert.ok(v.reason === "jump" || v.reason === "speed");
});

test("徒歩ではありえない速度の点は捨てる", () => {
  const prev = at(35.6812, 139.7671, 1000);
  // 2秒で100m = 50m/s
  const v = evaluateFix(prev, moved(100, 0, 3000), 1000);
  assert.equal(v.action, "reject");
  assert.equal(v.reason, "speed");
});

test("徒歩相当の移動は採用し、距離を返す", () => {
  const prev = at(35.6812, 139.7671, 1000);
  const v = evaluateFix(prev, moved(12, 0, 11000), 1000);
  assert.equal(v.action, "accept");
  assert.ok(Math.abs(v.distance - 12) < 1, `got ${v.distance}`);
  assert.equal(v.gap, false);
});

test("微小な揺れは動いていないものとして扱い、距離に足さない", () => {
  const prev = at(35.6812, 139.7671, 1000);
  const v = evaluateFix(prev, moved(1.5, 0, 5000), 1000);
  assert.equal(v.action, "hold");
  assert.equal(v.distance, 0);
});

test("精度が悪いほど、ノイズとみなす幅が広がる", () => {
  const prev = at(35.6812, 139.7671, 1000, 40);
  // 6m の移動は精度8mなら採用、精度40mならノイズ
  assert.equal(evaluateFix(prev, moved(6, 0, 5000, 8), 1000).action, "accept");
  assert.equal(evaluateFix(prev, moved(6, 0, 5000, 40), 1000).action, "hold");
});

test("GPSが長時間切れたあとの復帰は、軌跡を分断して受け入れる", () => {
  const prev = at(35.6812, 139.7671, 1000);
  const t = 1000 + GPS.GAP_MS + 5000;
  // 途切れている間に 600m 進んでいても、外れ値扱いにしない
  const v = evaluateFix(prev, moved(600, 0, t), 1000);
  assert.equal(v.action, "accept");
  assert.equal(v.gap, true);
  // 通った道が分からないので距離には足さない
  assert.equal(v.distance, 0);
});

test("立ち止まり続けただけでは軌跡を分断しない", () => {
  // 採用点は10分前だが、測位自体は1秒前まで来ていた場合
  const prev = at(35.6812, 139.7671, 0);
  const now = 600000;
  const v = evaluateFix(prev, moved(10, 0, now), now - 1000);
  assert.equal(v.action, "accept");
  assert.equal(v.gap, false, "受信が続いているので分断しない");
});

test("時刻が巻き戻った測位は捨てる", () => {
  const prev = at(35.6812, 139.7671, 5000);
  assert.equal(evaluateFix(prev, moved(5, 0, 4000), 5000).action, "reject");
});

// ── セグメント・距離の積み上げ ────────────────────
test("brkフラグで軌跡が分かれる", () => {
  const pts = [
    { lat: 35, lng: 135 },
    { lat: 35.001, lng: 135 },
    { lat: 35.01, lng: 135, brk: true },
    { lat: 35.011, lng: 135 },
  ];
  const segs = toSegments(pts);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].length, 2);
  assert.equal(segs[1].length, 2);
});

test("総距離は、途切れた区間をまたがずに合計する", () => {
  const pts = [
    { lat: 35, lng: 135 },
    { lat: 35.001, lng: 135 }, // +111m
    { lat: 35.1, lng: 135, brk: true }, // 途切れ → 加算しない
    { lat: 35.101, lng: 135 }, // +111m
  ];
  const d = totalDistance(pts);
  assert.ok(Math.abs(d - 222.4) < 1, `got ${d}`);
});

test("点が1つ以下なら距離は0", () => {
  assert.equal(totalDistance([]), 0);
  assert.equal(totalDistance([{ lat: 35, lng: 135 }]), 0);
});

// ── 標高 ──────────────────────────────────────────
test("累積標高は上りだけを足す", () => {
  const pts = [10, 20, 15, 25].map((alt) => ({ lat: 35, lng: 135, alt }));
  const g = elevationGain(pts, 4);
  assert.ok(Math.abs(g - 20) < 0.001, `got ${g}`); // 10→20 と 15→25
});

test("しきい値未満の細かい上下は無視する", () => {
  const pts = [10, 11, 10, 11, 10].map((alt) => ({ lat: 35, lng: 135, alt }));
  assert.equal(elevationGain(pts, 4), 0);
});

test("標高が取れない点しかなければ0", () => {
  const pts = [{ lat: 35, lng: 135, alt: null }, { lat: 35, lng: 135 }];
  assert.equal(elevationGain(pts), 0);
});

// ── 範囲 ──────────────────────────────────────────
test("boundsOfは南西と北東を返す", () => {
  const b = boundsOf([
    { lat: 35.1, lng: 139.5 },
    { lat: 35.3, lng: 139.9 },
    { lat: 35.2, lng: 139.7 },
  ]);
  assert.deepEqual(b, [
    [35.1, 139.5],
    [35.3, 139.9],
  ]);
});

test("点が無ければboundsはnull", () => {
  assert.equal(boundsOf([]), null);
});

// ── 表示 ──────────────────────────────────────────
test("距離の表示", () => {
  assert.equal(formatDistance(650), "650 m");
  assert.equal(formatDistance(8700), "8.7 km");
  assert.equal(formatDistance(1000), "1.0 km");
  assert.equal(formatDistance(999), "999 m");
});

test("距離は数値と単位に分けられる", () => {
  assert.deepEqual(splitDistance(8700), { value: "8.7", unit: "km" });
  assert.deepEqual(splitDistance(650), { value: "650", unit: "m" });
});

test("時間の表示", () => {
  assert.equal(formatDuration(2 * 3600000 + 14 * 60000), "2時間14分");
  assert.equal(formatDuration(86 * 60000), "1時間26分");
  assert.equal(formatDuration(45000), "45秒");
  assert.equal(formatDuration(0), "0秒");
});

test("記録中の時計表示", () => {
  assert.equal(formatClock(45000), "0:45");
  assert.equal(formatClock(3600000 + 125000), "1:02:05");
});

test("平均速度", () => {
  assert.ok(Math.abs(averageSpeed(8700, 2 * 3600000 + 14 * 60000) - 3.9) < 0.05);
  assert.equal(averageSpeed(1000, 0), 0);
});

test("dayKeyはローカル日付", () => {
  const d = new Date(2026, 7, 11, 23, 30);
  assert.equal(dayKey(d.getTime()), "2026-08-11");
});
