// GPS 歩行記録の心臓部。
// - watchPosition で測位を受け取り、外れ値を除いて軌跡に積む
// - 一時停止 / 再開 / 終了
// - 記録中は Wake Lock で画面を保たせる（ブラウザで測位を止められないため）
// - 数秒ごとに IndexedDB へ退避し、リロード・クラッシュしても記録が消えない

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GPS, evaluateFix, elevationGain, totalDistance } from "./geo.js";
import {
  newId,
  saveActiveWalk,
  loadActiveWalk,
  clearActiveWalk,
  finishWalk,
  requestPersistence,
} from "./db.js";

const AUTOSAVE_MS = 5000;

/**
 * 退避用のスナップショットを作る。
 * 走っている区間の経過時間を accumulatedMs に畳み込んでおくことで、
 * ここで落ちても「距離はあるのに歩行時間が0」という記録にならない。
 */
function snapshot(s) {
  const now = Date.now();
  return {
    walkId: s.walkId,
    startedAt: s.startedAt,
    status: s.status,
    points: s.points,
    distance: s.distance,
    accumulatedMs:
      s.accumulatedMs +
      (s.status === "recording" && s.segStartedAt ? now - s.segStartedAt : 0),
    segStartedAt: null,
    savedAt: now,
  };
}

const initialState = {
  status: "idle", // idle | recording | paused
  walkId: null,
  startedAt: null,
  points: [],
  distance: 0, // m
  accumulatedMs: 0, // 一時停止までに歩いた時間の合計
  segStartedAt: null, // 現在の歩行区間の開始時刻
};

export function useRecorder() {
  const [state, setState] = useState(initialState);
  const [current, setCurrent] = useState(null); // 表示用の現在地 {lat,lng,acc,heading,t}
  const [gpsWeak, setGpsWeak] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null); // 中断された前回の記録
  const [elapsed, setElapsed] = useState(0);

  const watchId = useRef(null);
  const wakeLock = useRef(null);
  // 直近の状態を同期的に読みたいので ref にも持つ（watchPosition コールバック用）
  const ref = useRef(initialState);
  const lastFixT = useRef(null); // 最後に「受信」した測位の時刻
  const lastAcceptT = useRef(null); // 最後に「採用」した測位の時刻
  const rejectStreak = useRef(0);
  const lastSaveAt = useRef(0);
  const forceBreak = useRef(false); // 次の採用点で軌跡を分断する（再開・復帰時）

  const commit = useCallback((updater) => {
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      ref.current = next;
      return next;
    });
  }, []);

  // ── Wake Lock（記録中に画面が消えると測位が止まるため） ──
  const acquireWakeLock = useCallback(async () => {
    try {
      if (!("wakeLock" in navigator)) return;
      if (wakeLock.current) return;
      wakeLock.current = await navigator.wakeLock.request("screen");
      wakeLock.current.addEventListener("release", () => {
        wakeLock.current = null;
      });
    } catch {
      // 非対応 / 拒否されても記録自体は続ける
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLock.current?.release();
    } catch {
      /* noop */
    }
    wakeLock.current = null;
  }, []);

  // ── 測位ハンドラ ────────────────────────────────
  const onPosition = useCallback(
    (pos) => {
      const c = pos.coords;
      const t = pos.timestamp || Date.now();
      const fix = {
        lat: c.latitude,
        lng: c.longitude,
        t,
        acc: Number.isFinite(c.accuracy) ? c.accuracy : null,
        alt: Number.isFinite(c.altitude) ? c.altitude : null,
      };

      setError(null);
      setCurrent({ ...fix, heading: Number.isFinite(c.heading) ? c.heading : null });
      setGpsWeak(fix.acc != null && fix.acc > GPS.WEAK_ACCURACY);

      const prevFixT = lastFixT.current;
      lastFixT.current = t;

      if (ref.current.status !== "recording") return;

      // 取りすぎ防止。ただし前回採用から間隔が空いているときは必ず評価する。
      const sinceAccept = lastAcceptT.current ? t - lastAcceptT.current : Infinity;
      if (sinceAccept < GPS.MIN_INTERVAL_MS) return;

      const pts = ref.current.points;
      const prev = pts.length ? pts[pts.length - 1] : null;
      let verdict = evaluateFix(prev, fix, prevFixT);

      if (verdict.action === "reject") {
        rejectStreak.current += 1;
        // 何度もはじき続けるのは、GPS が本当に別の場所を指している可能性がある。
        // 一定回数を超えたら軌跡を分断したうえで受け入れ直す（記録を止めない）。
        if (rejectStreak.current >= GPS.RESYNC_AFTER_REJECTS && verdict.reason !== "accuracy") {
          verdict = { action: "accept", distance: 0, gap: true };
        } else {
          if (verdict.reason === "accuracy") setGpsWeak(true);
          return;
        }
      }
      rejectStreak.current = 0;
      if (verdict.action === "hold") return; // 立ち止まっている

      const brk = verdict.gap || forceBreak.current;
      forceBreak.current = false;
      lastAcceptT.current = t;
      commit((s) => ({
        ...s,
        points: [...s.points, brk && s.points.length ? { ...fix, brk: true } : fix],
        distance: s.distance + (brk ? 0 : verdict.distance),
      }));
    },
    [commit]
  );

  const onPositionError = useCallback((err) => {
    // 記録は絶対に止めない（§19）。権限を落とされたときだけ止める。
    if (err.code === 1) {
      setError(
        "位置情報が許可されていません。ブラウザの設定でこのサイトの位置情報を「許可」にしてください。"
      );
    } else {
      setGpsWeak(true);
    }
  }, []);

  const startWatch = useCallback(() => {
    if (watchId.current != null) return;
    if (!navigator.geolocation) {
      setError("この端末では位置情報を利用できません。");
      return;
    }
    if (!window.isSecureContext) {
      setError(
        "位置情報は https でのみ利用できます。https の URL で開き直してください。"
      );
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      onPosition,
      onPositionError,
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 }
    );
  }, [onPosition, onPositionError]);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  // ── 起動時：現在地の表示だけは常に動かす + 中断記録の検出 ──
  useEffect(() => {
    startWatch();
    requestPersistence();
    loadActiveWalk().then((saved) => {
      if (saved && saved.points?.length >= 2) setPending(saved);
      else if (saved) clearActiveWalk();
    });
    return () => {
      stopWatch();
      releaseWakeLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 経過時間の更新 & GPS 途切れ監視 ──
  useEffect(() => {
    const tick = () => {
      const s = ref.current;
      setElapsed(
        s.accumulatedMs + (s.status === "recording" && s.segStartedAt ? Date.now() - s.segStartedAt : 0)
      );
      if (lastFixT.current && Date.now() - lastFixT.current > GPS.STALE_MS) {
        setGpsWeak(true);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── 記録中の自動退避 ──
  useEffect(() => {
    if (state.status === "idle") return;
    const now = Date.now();
    if (now - lastSaveAt.current < AUTOSAVE_MS) return;
    lastSaveAt.current = now;
    saveActiveWalk(snapshot(state));
  }, [state]);

  // ── 画面が戻ってきたら Wake Lock を取り直す ──
  useEffect(() => {
    // 離脱するかもしれない瞬間には、間隔を待たずに必ず退避する
    const saveNow = () => {
      if (ref.current.status === "idle") return;
      lastSaveAt.current = 0;
      saveActiveWalk(snapshot(ref.current));
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (ref.current.status === "recording") acquireWakeLock();
        // バックグラウンドで watch が止められていることがあるので張り直す
        if (ref.current.status !== "idle" && watchId.current == null) startWatch();
      } else {
        saveNow();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", saveNow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", saveNow);
    };
  }, [acquireWakeLock, startWatch]);

  // ── 操作 ────────────────────────────────────────
  const start = useCallback(() => {
    const now = Date.now();
    lastAcceptT.current = null;
    rejectStreak.current = 0;
    lastSaveAt.current = 0;
    commit({
      status: "recording",
      walkId: newId(),
      startedAt: now,
      points: current ? [{ lat: current.lat, lng: current.lng, t: now, acc: current.acc, alt: current.alt }] : [],
      distance: 0,
      accumulatedMs: 0,
      segStartedAt: now,
    });
    startWatch();
    acquireWakeLock();
  }, [commit, current, startWatch, acquireWakeLock]);

  const pause = useCallback(() => {
    commit((s) => {
      if (s.status !== "recording") return s;
      return {
        ...s,
        status: "paused",
        accumulatedMs: s.accumulatedMs + (Date.now() - s.segStartedAt),
        segStartedAt: null,
      };
    });
    lastSaveAt.current = 0;
    // 測位自体は現在地表示のために続ける（軌跡には積まない）。
    // 画面を点けっぱなしにする必要はもう無いので、Wake Lock だけ手放す。
    releaseWakeLock();
  }, [commit, releaseWakeLock]);

  const resume = useCallback(() => {
    lastAcceptT.current = null;
    rejectStreak.current = 0;
    // 止まっている間に移動している可能性があるので、再開後の最初の点で軌跡を分断する
    forceBreak.current = true;
    commit((s) => {
      if (s.status !== "paused") return s;
      return { ...s, status: "recording", segStartedAt: Date.now() };
    });
    startWatch();
    acquireWakeLock();
  }, [commit, startWatch, acquireWakeLock]);

  /** 記録を確定して保存する。保存できたら walk を返す。 */
  const stop = useCallback(async () => {
    const s = ref.current;
    if (s.status === "idle") return null;
    const duration =
      s.accumulatedMs + (s.status === "recording" && s.segStartedAt ? Date.now() - s.segStartedAt : 0);
    const walk = await finishWalk({
      id: s.walkId,
      startedAt: s.startedAt,
      endedAt: Date.now(),
      duration,
      points: s.points,
    });
    await clearActiveWalk();
    stopWatch();
    releaseWakeLock();
    commit(initialState);
    setElapsed(0);
    startWatch(); // 現在地表示は続ける
    return walk;
  }, [commit, stopWatch, releaseWakeLock, startWatch]);

  /** 記録を保存せずに捨てる */
  const discard = useCallback(async () => {
    await clearActiveWalk();
    stopWatch();
    releaseWakeLock();
    commit(initialState);
    setElapsed(0);
    startWatch();
  }, [commit, stopWatch, releaseWakeLock, startWatch]);

  // ── 中断された記録の扱い ──
  const recoverResume = useCallback(() => {
    if (!pending) return;
    lastAcceptT.current = null;
    rejectStreak.current = 0;
    forceBreak.current = true; // 中断前後は連続していないので線で結ばない
    commit({
      status: "recording",
      walkId: pending.walkId,
      startedAt: pending.startedAt,
      points: pending.points || [],
      distance: pending.distance ?? totalDistance(pending.points || []),
      accumulatedMs: pending.accumulatedMs || 0,
      segStartedAt: Date.now(),
    });
    setPending(null);
    startWatch();
    acquireWakeLock();
  }, [pending, commit, startWatch, acquireWakeLock]);

  const recoverSave = useCallback(async () => {
    if (!pending) return null;
    const walk = await finishWalk({
      id: pending.walkId,
      startedAt: pending.startedAt,
      endedAt: pending.savedAt || Date.now(),
      duration: pending.accumulatedMs || 0,
      points: pending.points || [],
    });
    await clearActiveWalk();
    setPending(null);
    return walk;
  }, [pending]);

  const recoverDiscard = useCallback(async () => {
    await clearActiveWalk();
    setPending(null);
  }, []);

  const elevGain = useMemo(() => elevationGain(state.points), [state.points]);

  return {
    ...state,
    elapsed,
    current,
    gpsWeak,
    error,
    pending,
    elevGain,
    start,
    pause,
    resume,
    stop,
    discard,
    recoverResume,
    recoverSave,
    recoverDiscard,
  };
}
