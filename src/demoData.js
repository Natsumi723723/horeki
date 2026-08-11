// デモデータ。実際に歩く前に「どんなアプリか」を見るためのもの。
// demo: true の印が付くので、いつでもまとめて消せる。
//
// 街区を曲がりながら歩いたように見えるルートを手続き的に作る。
// 直線一本ではなく、角を曲がり、たまに引き返す。

import { finishWalk, addCheckin, newId } from "./db.js";

const M_PER_LAT = 111320;
const mPerLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

/** 再現性のある乱数（同じ種なら毎回同じデモが出る） */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 街歩きらしい折れ線を作る。
 * 東西南北に区画ぶん進み、角で向きを変える。ときどき寄り道して戻る。
 */
function buildRoute(startLat, startLng, { seed, legs = 14 }) {
  const rand = rng(seed);
  const pts = [[startLat, startLng]];
  let lat = startLat;
  let lng = startLng;
  const mLng = mPerLng(startLat);
  // 0=北 1=東 2=南 3=西
  let dir = Math.floor(rand() * 4);

  for (let i = 0; i < legs; i++) {
    // 1区画 60〜180m
    const len = 60 + rand() * 120;
    const dLat = [1, 0, -1, 0][dir] * (len / M_PER_LAT);
    const dLng = [0, 1, 0, -1][dir] * (len / mLng);
    lat += dLat;
    lng += dLng;
    pts.push([lat, lng]);
    // 7割で曲がる、3割で直進を続ける
    if (rand() < 0.7) dir = (dir + (rand() < 0.5 ? 1 : 3)) % 4;
  }
  return pts;
}

/** 折れ線を、徒歩の速度で歩いたときのGPS点列に変換する */
function walkAlong(route, { startAt, speed = 1.3, intervalSec = 4, seed = 1 }) {
  const rand = rng(seed);
  const points = [];
  let t = startAt;
  const baseAlt = 8 + rand() * 30;

  for (let i = 1; i < route.length; i++) {
    const [aLat, aLng] = route[i - 1];
    const [bLat, bLng] = route[i];
    const mLng = mPerLng(aLat);
    const segM = Math.hypot((bLat - aLat) * M_PER_LAT, (bLng - aLng) * mLng);
    const steps = Math.max(1, Math.round(segM / (speed * intervalSec)));
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      // 実機らしく数mの揺れを混ぜる（距離が不自然に綺麗にならないように）
      const jitter = 0.00002;
      points.push({
        lat: aLat + (bLat - aLat) * f + (rand() - 0.5) * jitter,
        lng: aLng + (bLng - aLng) * f + (rand() - 0.5) * jitter,
        t: Math.round(t),
        acc: 5 + rand() * 9,
        alt: baseAlt + Math.sin((points.length / 30) + seed) * 6,
      });
      t += intervalSec * 1000 * (0.9 + rand() * 0.2);
    }
  }
  const last = route[route.length - 1];
  points.push({
    lat: last[0],
    lng: last[1],
    t: Math.round(t),
    acc: 6,
    alt: baseAlt,
  });
  return points;
}

/** その日の hh:mm に合わせた時刻（daysAgo 日前） */
function timeAgo(daysAgo, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

// 歩き出す場所（都内・多摩川沿いを中心に散らす）
const COURSES = [
  {
    name: "谷中・根津",
    lat: 35.7268,
    lng: 139.7663,
    daysAgo: 0,
    hour: 14,
    minute: 12,
    legs: 18,
    seed: 11,
    spots: [
      { name: "谷中霊園", category: "historic", dLat: 0.0016, dLng: 0.0012, description: "徳川慶喜の墓所がある広大な霊園。桜並木で知られる。", wikipediaTitle: "谷中霊園" },
      { name: "根津神社", category: "shrine", dLat: -0.0021, dLng: -0.0018, description: "神社。千本鳥居とつつじ苑で知られる。（1706年建立）", wikipediaTitle: "根津神社" },
    ],
  },
  {
    name: "多摩川台",
    lat: 35.5817,
    lng: 139.6673,
    daysAgo: 2,
    hour: 10,
    minute: 5,
    legs: 22,
    seed: 27,
    spots: [
      { name: "亀甲山古墳", category: "historic", dLat: 0.0004, dLng: 0.0006, description: "古墳・墓所。多摩川台公園内に残る前方後円墳。", wikipediaTitle: "亀甲山古墳" },
      { name: "多摩川浅間神社", category: "shrine", dLat: -0.0022, dLng: -0.0006, description: "神社。多摩川を見下ろす高台に鎮座し、富士山信仰を伝える。", wikipediaTitle: "多摩川浅間神社" },
      { name: "多摩川台公園", category: "nature", dLat: 0.0009, dLng: 0.0014, description: "公園。多摩川沿いの丘に古墳群が点在する。", wikipediaTitle: "多摩川台公園" },
    ],
  },
  {
    name: "神楽坂",
    lat: 35.7014,
    lng: 139.7401,
    daysAgo: 5,
    hour: 16,
    minute: 40,
    legs: 12,
    seed: 43,
    spots: [
      { name: "赤城神社", category: "shrine", dLat: 0.0011, dLng: -0.0009, description: "神社。牛込の総鎮守として親しまれている。", wikipediaTitle: "赤城神社 (新宿区)" },
    ],
  },
  {
    name: "深川・清澄",
    lat: 35.6816,
    lng: 139.7996,
    daysAgo: 9,
    hour: 11,
    minute: 20,
    legs: 20,
    seed: 58,
    spots: [
      { name: "清澄庭園", category: "nature", dLat: 0.0007, dLng: -0.0011, description: "回遊式林泉庭園。全国から集めた名石が置かれている。", wikipediaTitle: "清澄庭園" },
      { name: "深川江戸資料館", category: "museum", dLat: 0.0018, dLng: 0.0007, description: "博物館・美術館。江戸時代の深川の町並みを実物大で再現。", wikipediaTitle: "深川江戸資料館" },
    ],
  },
  {
    name: "上野・湯島",
    lat: 35.7089,
    lng: 139.7741,
    daysAgo: 14,
    hour: 13,
    minute: 0,
    legs: 16,
    seed: 71,
    spots: [
      { name: "湯島天満宮", category: "shrine", dLat: -0.0014, dLng: -0.0016, description: "神社。学問の神として菅原道真を祀る。", wikipediaTitle: "湯島天満宮" },
    ],
  },
  {
    name: "等々力",
    lat: 35.6046,
    lng: 139.6469,
    daysAgo: 21,
    hour: 9,
    minute: 35,
    legs: 15,
    seed: 89,
    spots: [
      { name: "等々力渓谷", category: "nature", dLat: 0.0006, dLng: 0.0009, description: "自然保護区。23区唯一の渓谷として親しまれている。", wikipediaTitle: "等々力渓谷" },
    ],
  },
];

/**
 * デモの歩行記録とチェックインをまとめて作る。
 * すでに入れてある場合は二重に入らないよう、呼ぶ前に hasDemoData() を見ること。
 * @returns {{walks:number, checkins:number, distance:number}}
 */
export async function seedDemoData() {
  let walks = 0;
  let checkins = 0;
  let distance = 0;

  for (const c of COURSES) {
    const startAt = timeAgo(c.daysAgo, c.hour, c.minute);
    const route = buildRoute(c.lat, c.lng, { seed: c.seed, legs: c.legs });
    const points = walkAlong(route, { startAt, seed: c.seed });
    const endedAt = points[points.length - 1].t;

    const walk = await finishWalk({
      id: newId(),
      startedAt: startAt,
      endedAt,
      // 歩行時間は実際の点列の長さから出す（数字の辻褄が合うように）
      duration: endedAt - startAt,
      points,
      demo: true,
    });
    if (!walk) continue;
    walks++;
    distance += walk.distance;

    // 訪問時刻は、その歩行の中に必ず収まるよう等間隔に置く。
    // 固定の「開始から何分」にすると、短い記録では終了後の時刻になってしまう。
    const span = endedAt - startAt;
    for (const [i, s] of c.spots.entries()) {
      const at = Math.round(startAt + (span * (i + 1)) / (c.spots.length + 1));
      await addCheckin(
        {
          id: `demo/${c.name}/${s.name}`,
          name: s.name,
          category: s.category,
          lat: c.lat + s.dLat,
          lng: c.lng + s.dLng,
          description: s.description,
          // 写真は Wikipedia から後で引く（デモでも実物の写真が出るように）
          wikipediaTitle: s.wikipediaTitle || null,
          wikipediaLang: "ja",
          wikipediaUrl: s.wikipediaTitle
            ? `https://ja.wikipedia.org/wiki/${encodeURIComponent(s.wikipediaTitle)}`
            : null,
        },
        { walkId: walk.id, at, demo: true }
      );
      checkins++;
    }
  }

  return { walks, checkins, distance };
}
