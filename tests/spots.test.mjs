// 周辺スポットの分類・除外ルールのテスト。
// ここは実際のOSMデータを見て調整したルールなので、崩れると
// 「歴史や文化に出会える」というアプリの趣旨が壊れる。
// ネットワークには一切アクセスしない（純関数のみを対象にする）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  SAMPLE_SPOTS,
  classifySpot,
  isExcluded,
  buildDescription,
  buildWikipediaUrl,
} from "../src/spots.js";

// ── カテゴリ判定 ──────────────────────────────────
test("礼拝所は神社・寺", () => {
  assert.equal(classifySpot({ amenity: "place_of_worship", religion: "shinto" }), "shrine");
  assert.equal(classifySpot({ amenity: "place_of_worship", religion: "buddhist" }), "shrine");
});

test("amenityが無く historic=wayside_shrine だけの稲荷社も神社・寺", () => {
  // OSMでは祠や小さな稲荷社が historic だけで登録されていることが多い。
  // 名前が「〜神社」なのに 🏯 が出るのを防ぐルール。
  assert.equal(classifySpot({ historic: "wayside_shrine", name: "京浜伏見稲荷神社" }), "shrine");
  assert.equal(classifySpot({ historic: "temple" }), "shrine");
});

test("博物館・図書館・劇場は博物館・文化施設", () => {
  assert.equal(classifySpot({ tourism: "museum" }), "museum");
  assert.equal(classifySpot({ tourism: "gallery" }), "museum");
  assert.equal(classifySpot({ amenity: "library" }), "museum");
  assert.equal(classifySpot({ amenity: "arts_centre" }), "museum");
});

test("historic は史跡", () => {
  assert.equal(classifySpot({ historic: "memorial" }), "historic");
  assert.equal(classifySpot({ historic: "castle" }), "historic");
});

test("公園・自然", () => {
  assert.equal(classifySpot({ leisure: "park" }), "nature");
  assert.equal(classifySpot({ natural: "tree" }), "nature");
});

test("それ以外は歴史・文化スポット", () => {
  assert.equal(classifySpot({ tourism: "attraction" }), "culture");
  assert.equal(classifySpot({}), "culture");
});

test("全カテゴリキーが CATEGORIES に存在する", () => {
  for (const k of ["historic", "shrine", "museum", "culture", "nature"]) {
    assert.ok(CATEGORIES[k], `${k} が無い`);
    assert.ok(CATEGORIES[k].icon && CATEGORIES[k].label);
  }
});

// ── 除外ルール ────────────────────────────────────
test("飲食店は tourism=attraction が付いていても除外する", () => {
  // 実データ：東京ラーメンストリート
  assert.equal(
    isExcluded({ amenity: "food_court", name: "東京ラーメンストリート", tourism: "attraction" }),
    true
  );
  assert.equal(isExcluded({ amenity: "cafe" }), true);
  assert.equal(isExcluded({ amenity: "restaurant" }), true);
});

test("通路（highway）はスポットではないので除外する", () => {
  // 実データ：東京キャラクターストリート（indoor=yes の footway）
  assert.equal(
    isExcluded({ highway: "footway", indoor: "yes", name: "Tokyo Character Street", tourism: "attraction" }),
    true
  );
});

test("物販は除外する", () => {
  assert.equal(isExcluded({ shop: "convenience" }), true);
});

test("historic が付いていれば除外しない（歴史ある街道・商家を落とさない）", () => {
  assert.equal(isExcluded({ highway: "path", historic: "yes" }), false);
  assert.equal(isExcluded({ shop: "bakery", historic: "building" }), false);
});

test("画廊は shop=art が併記されていても除外しない", () => {
  // 実データ：ギャラリー椿。作品を売るため shop=art が付くのが普通
  assert.equal(isExcluded({ shop: "art", tourism: "gallery", name: "ギャラリー椿" }), false);
  // shop=art 単体（ただの画材店・骨董店）は除外したまま
  assert.equal(isExcluded({ shop: "art" }), true);
});

test("史跡・寺社・公園は除外しない", () => {
  assert.equal(isExcluded({ historic: "monument" }), false);
  assert.equal(isExcluded({ amenity: "place_of_worship" }), false);
  assert.equal(isExcluded({ leisure: "park" }), false);
});

// ── 説明文 ────────────────────────────────────────
test("既存の説明タグがあればそれを使う", () => {
  assert.equal(buildDescription({ "description:ja": "渡し場の跡。" }), "渡し場の跡。");
  assert.equal(buildDescription({ description: "古い井戸。" }), "古い井戸。");
});

test("historic の具体値を tourism=attraction より優先する", () => {
  // 実データ：動輪の広場。両方付いているが「記念碑。」が正しい
  const d = buildDescription({ historic: "memorial", tourism: "attraction" });
  assert.equal(d, "記念碑。");
});

test("知らない値でもカテゴリ名で必ず日本語1文になる", () => {
  const d = buildDescription({ historic: "totally_unknown_value_xyz" });
  assert.ok(d.length > 0);
  assert.ok(d.endsWith("。"), `got ${d}`);
});

test("説明文が空文字になることはない", () => {
  for (const tags of [{}, { tourism: "attraction" }, { natural: "tree" }, { leisure: "garden" }]) {
    const d = buildDescription(tags);
    assert.ok(d && d.trim().length > 0, JSON.stringify(tags));
  }
});

// ── Wikipedia URL ─────────────────────────────────
test("wikipedia タグから閲覧URLを作る", () => {
  assert.equal(
    buildWikipediaUrl({ wikipedia: "ja:浅草寺" }),
    `https://ja.wikipedia.org/wiki/${encodeURIComponent("浅草寺")}`
  );
});

test("言語プレフィックスが無ければ日本語版とみなす", () => {
  assert.equal(
    buildWikipediaUrl({ wikipedia: "浅草神社" }),
    `https://ja.wikipedia.org/wiki/${encodeURIComponent("浅草神社")}`
  );
});

test("wikidata しか無ければ wikidata のURL", () => {
  assert.equal(buildWikipediaUrl({ wikidata: "Q11524461" }), "https://www.wikidata.org/wiki/Q11524461");
});

test("何も無ければ null", () => {
  assert.equal(buildWikipediaUrl({}), null);
  assert.equal(buildWikipediaUrl(null), null);
});

// ── サンプルデータ ────────────────────────────────
test("サンプルデータは8件で、5カテゴリすべてを含む", () => {
  assert.equal(SAMPLE_SPOTS.length, 8);
  const cats = new Set(SAMPLE_SPOTS.map((s) => s.category));
  for (const k of Object.keys(CATEGORIES)) {
    assert.ok(cats.has(k), `${k} のサンプルが無い`);
  }
});

test("サンプルデータは仕様書の例を含む", () => {
  const s = SAMPLE_SPOTS.find((x) => x.name === "丸子の渡し跡");
  assert.ok(s, "丸子の渡し跡が無い");
  assert.equal(s.category, "historic");
  assert.ok(s.description.includes("渡し場"));
});

test("サンプルデータの座標は多摩川周辺の現実的な値", () => {
  for (const s of SAMPLE_SPOTS) {
    assert.ok(s.lat > 35.5 && s.lat < 35.65, `${s.name} の緯度 ${s.lat}`);
    assert.ok(s.lng > 139.6 && s.lng < 139.72, `${s.name} の経度 ${s.lng}`);
    assert.ok(s.id && s.name && s.category, `${s.name} に欠損`);
    assert.ok(CATEGORIES[s.category], `${s.name} のカテゴリが不正`);
  }
});
