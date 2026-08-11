// PWAアイコン生成：濃い藍の地に、生成りの歩いた道が一本。終点に朱の点。
// 依存ライブラリなし（Node標準のzlibでPNGを直接エンコード）
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(outDir, { recursive: true });

/* ---- minimal PNG encoder ---- */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
function encodePNG(width, height, rgbaAt) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rgbaAt(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---- 色 ---- */
const AI_DARK = [0x24, 0x34, 0x47]; // 濃い藍（地）
const KINARI = [0xf4, 0xf0, 0xe6]; // 生成り（道）
const SHU = [0xa6, 0x4b, 0x3c]; // 朱（現在地）

/* ---- 道のかたち（maskable の安全域に収まるよう中央寄せ） ---- */
const CTRL = [
  [0.24, 0.80],
  [0.42, 0.72],
  [0.34, 0.56],
  [0.52, 0.47],
  [0.66, 0.50],
  [0.70, 0.30],
];

// Catmull-Rom で滑らかな折れ線に展開する
function smoothPath(pts, steps = 24) {
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const PATH = smoothPath(CTRL);

/** 点から折れ線までの最短距離（正規化座標） */
function distToPath(x, y) {
  let best = Infinity;
  for (let i = 1; i < PATH.length; i++) {
    const [ax, ay] = PATH[i - 1];
    const [bx, by] = PATH[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let t = ((x - ax) * dx + (y - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < best) best = d;
  }
  return best;
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [
  Math.round(lerp(c1[0], c2[0], t)),
  Math.round(lerp(c1[1], c2[1], t)),
  Math.round(lerp(c1[2], c2[2], t)),
];

const END = CTRL[CTRL.length - 1];
const HALF_STROKE = 0.032; // 道の太さの半分
const DOT_R = 0.062; // 朱の点
const RING_R = 0.088; // 点のまわりの生成りの輪

function makeIcon(size) {
  return encodePNG(size, size, (px, py) => {
    // 3x3 スーパーサンプリングで縁をなめらかに
    let path = 0;
    let dot = 0;
    let ring = 0;
    for (let sy = 0; sy < 3; sy++) {
      for (let sx = 0; sx < 3; sx++) {
        const x = (px + (sx + 0.5) / 3) / size;
        const y = (py + (sy + 0.5) / 3) / size;
        if (distToPath(x, y) < HALF_STROKE) path++;
        const de = Math.hypot(x - END[0], y - END[1]);
        if (de < DOT_R) dot++;
        else if (de < RING_R) ring++;
      }
    }
    let color = AI_DARK;
    if (path > 0) color = mix(color, KINARI, path / 9);
    if (ring > 0) color = mix(color, KINARI, ring / 9);
    if (dot > 0) color = mix(color, SHU, dot / 9);
    return [color[0], color[1], color[2], 255];
  });
}

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(join(outDir, name), makeIcon(size));
  console.log(`✓ ${name} (${size}x${size})`);
}
