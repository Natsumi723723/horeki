// 開発用の歩行シミュレータ。`npm run dev` で ?mock=walk を付けたときだけ動く。
// 本番ビルドでは import.meta.env.DEV が false になり、丸ごと取り除かれる。
//
// 実機を持ち出さなくても以下を確認できる：
//   - 軌跡が伸びていくこと / 距離と時間が増えること
//   - 精度の悪い測位と、突然のジャンプが除外されること
//   - 一時停止・再開・終了・保存が壊れないこと

const START = [35.6812, 139.7671]; // 東京駅

/** 徒歩のコースを作る（東京駅まわりを一周する感じの折れ線） */
function buildRoute() {
  const legs = [
    [0, 1], // 北へ
    [1, 0.3], // 北東へ
    [0.2, -1], // 東〜南へ
    [-1, -0.4], // 南西へ
    [-0.6, 0.9], // 北西へ
  ];
  const pts = [START];
  let [lat, lng] = START;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((START[0] * Math.PI) / 180);
  for (const [dx, dy] of legs) {
    const len = 320; // 1辺 320m くらい
    const n = Math.hypot(dx, dy) || 1;
    lat += ((dy / n) * len) / mPerLat;
    lng += ((dx / n) * len) / mPerLng;
    pts.push([lat, lng]);
  }
  return pts;
}

/** 折れ線上を等速で進んだときの、距離 d(m) 地点の座標 */
function pointAt(route, d) {
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((START[0] * Math.PI) / 180);
  let rest = d;
  for (let i = 1; i < route.length; i++) {
    const [aLat, aLng] = route[i - 1];
    const [bLat, bLng] = route[i];
    const dx = (bLng - aLng) * mPerLng;
    const dy = (bLat - aLat) * mPerLat;
    const seg = Math.hypot(dx, dy);
    if (rest <= seg) {
      const t = seg === 0 ? 0 : rest / seg;
      return [aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t];
    }
    rest -= seg;
  }
  return route[route.length - 1]; // 終点で止まる
}

export function installMockGeolocation({ speed = 1.35, tick = 1000 } = {}) {
  const route = buildRoute();
  const watchers = new Map();
  let nextId = 1;
  let travelled = 0;
  let n = 0;

  const makePosition = () => {
    n++;
    const [lat, lng] = pointAt(route, travelled);
    // 実機らしく数mの揺れを混ぜる
    const jitter = 0.000025;
    let out = {
      latitude: lat + (Math.random() - 0.5) * jitter,
      longitude: lng + (Math.random() - 0.5) * jitter,
      accuracy: 6 + Math.random() * 8,
      altitude: 22 + Math.sin(travelled / 180) * 9,
      altitudeAccuracy: 5,
      heading: null,
      speed,
    };
    // 25回に1回、数百m飛ぶ異常値を混ぜる（除外されるはず）
    if (n % 25 === 0) {
      out = { ...out, latitude: lat + 0.008, longitude: lng - 0.006 };
    }
    // 40回に1回、精度の悪い測位を混ぜる（除外されるはず）
    if (n % 40 === 0) {
      out = { ...out, accuracy: 140 };
    }
    return { coords: out, timestamp: Date.now() };
  };

  const timer = setInterval(() => {
    travelled += speed * (tick / 1000);
    const pos = makePosition();
    for (const cb of watchers.values()) cb(pos);
  }, tick);

  const mock = {
    watchPosition(success) {
      const id = nextId++;
      watchers.set(id, success);
      setTimeout(() => success(makePosition()), 120);
      return id;
    },
    clearWatch(id) {
      watchers.delete(id);
    },
    getCurrentPosition(success) {
      success(makePosition());
    },
    _stop: () => clearInterval(timer),
  };

  Object.defineProperty(navigator, "geolocation", {
    value: mock,
    configurable: true,
  });
  // Wake Lock 非対応環境でも動くようにダミーを入れておく
  if (!("wakeLock" in navigator)) {
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: async () => ({ release: async () => {}, addEventListener() {} }) },
      configurable: true,
    });
  }
  window.__mockGeo = mock;
  console.info("[mock] 歩行シミュレータを開始しました");
}
