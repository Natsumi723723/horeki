// 端末内データ保存層（IndexedDB）。
// UI からはこのモジュール経由でしか触らない。将来クラウド同期を足すときは
// ここを差し替えるだけで済むようにしてある。
//
// ⚠ DB_NAME / ストア名 / キー名は絶対に変更しないこと。
//   変更すると既存ユーザーの歩行記録が読み出せなくなる。

import { openDB } from "idb";
import { DB_NAME, DB_VERSION } from "./config.js";
import { totalDistance, elevationGain, dayKey } from "./geo.js";

const STORE_WALKS = "walks"; // 歩行記録のメタ情報（一覧表示用・軽い）
const STORE_TRACKS = "tracks"; // GPS 点列（重いので別ストア）
const STORE_META = "meta"; // 記録中の状態など、単発の値

let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE_WALKS)) {
          const s = d.createObjectStore(STORE_WALKS, { keyPath: "id" });
          s.createIndex("by-startedAt", "startedAt");
        }
        if (!d.objectStoreNames.contains(STORE_TRACKS)) {
          d.createObjectStore(STORE_TRACKS, { keyPath: "walkId" });
        }
        if (!d.objectStoreNames.contains(STORE_META)) {
          d.createObjectStore(STORE_META);
        }
      },
    });
  }
  return dbPromise;
}

/** ブラウザにデータの永続化を要求する（ストレージ逼迫時に消されにくくする） */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* 非対応ブラウザは黙って諦める */
  }
  return false;
}

export function newId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── 記録中の状態（クラッシュ・リロード復帰用） ─────────────
const ACTIVE_KEY = "activeWalk";

export async function saveActiveWalk(state) {
  const d = await db();
  await d.put(STORE_META, state, ACTIVE_KEY);
}

export async function loadActiveWalk() {
  const d = await db();
  return (await d.get(STORE_META, ACTIVE_KEY)) || null;
}

export async function clearActiveWalk() {
  const d = await db();
  await d.delete(STORE_META, ACTIVE_KEY);
}

// ── 歩行記録 ─────────────────────────────────────────

/**
 * 歩行を確定保存する。メタと点列を1トランザクションで書くので、
 * 途中で失敗しても中途半端な記録は残らない。
 * @returns {object|null} 保存した walk。点が少なすぎる場合は null（保存しない）
 */
export async function finishWalk({ id, startedAt, endedAt, duration, points }) {
  if (!points || points.length < 2) return null;

  const distance = totalDistance(points);
  const walk = {
    id,
    startedAt,
    endedAt,
    duration, // 一時停止を除いた歩行時間 (ms)
    distance, // m
    pointCount: points.length,
    elevGain: elevationGain(points),
    dayKey: dayKey(startedAt),
    createdAt: Date.now(),
  };

  const d = await db();
  const tx = d.transaction([STORE_WALKS, STORE_TRACKS], "readwrite");
  await Promise.all([
    tx.objectStore(STORE_WALKS).put(walk),
    tx.objectStore(STORE_TRACKS).put({ walkId: id, points }),
    tx.done,
  ]);
  return walk;
}

/** 一覧用。新しい順。点列は含まないので軽い。 */
export async function listWalks() {
  const d = await db();
  const all = await d.getAllFromIndex(STORE_WALKS, "by-startedAt");
  return all.reverse();
}

export async function getWalk(id) {
  const d = await db();
  return (await d.get(STORE_WALKS, id)) || null;
}

export async function getTrack(id) {
  const d = await db();
  const rec = await d.get(STORE_TRACKS, id);
  return rec?.points || [];
}

export async function deleteWalk(id) {
  const d = await db();
  const tx = d.transaction([STORE_WALKS, STORE_TRACKS], "readwrite");
  await Promise.all([
    tx.objectStore(STORE_WALKS).delete(id),
    tx.objectStore(STORE_TRACKS).delete(id),
    tx.done,
  ]);
}

/** MY MAP 用。全記録の点列をまとめて取る。 */
export async function getAllTracks() {
  const d = await db();
  return await d.getAll(STORE_TRACKS);
}

/** 累計距離・記録回数・歩いた日数 */
export async function getStats() {
  const walks = await listWalks();
  const days = new Set(walks.map((w) => w.dayKey || dayKey(w.startedAt)));
  return {
    totalDistance: walks.reduce((s, w) => s + (w.distance || 0), 0),
    totalDuration: walks.reduce((s, w) => s + (w.duration || 0), 0),
    count: walks.length,
    days: days.size,
  };
}

/** 全記録を JSON で書き出す（バックアップ）。将来のクラウド同期の下地でもある。 */
export async function exportAll() {
  const walks = await listWalks();
  const tracks = await getAllTracks();
  return {
    app: "horeki",
    version: 1,
    exportedAt: new Date().toISOString(),
    walks,
    tracks,
  };
}

/** バックアップの取り込み。既存の同 id は上書きせずスキップする。 */
export async function importAll(data) {
  if (!data || data.app !== "horeki" || !Array.isArray(data.walks)) {
    throw new Error("形式が違うファイルです");
  }
  const d = await db();
  const existing = new Set((await listWalks()).map((w) => w.id));
  const trackMap = new Map((data.tracks || []).map((t) => [t.walkId, t.points]));
  let added = 0;

  for (const w of data.walks) {
    if (!w?.id || existing.has(w.id)) continue;
    const points = trackMap.get(w.id) || [];
    const tx = d.transaction([STORE_WALKS, STORE_TRACKS], "readwrite");
    await Promise.all([
      tx.objectStore(STORE_WALKS).put(w),
      tx.objectStore(STORE_TRACKS).put({ walkId: w.id, points }),
      tx.done,
    ]);
    added++;
  }
  return { added, skipped: data.walks.length - added };
}
