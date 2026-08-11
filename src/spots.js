/**
 * spots.js — 歩歴（Horeki）周辺スポット取得データ層
 *
 * 歩いている途中で「歴史や文化に出会える」ことを目的としたデータ層。
 * 飲食店・コンビニなどの一般POIは対象外。史跡・寺社・博物館・文化施設・公園を扱う。
 *
 * 依存: ./geo.js の haversine(lat1, lng1, lat2, lng2) => メートル
 */

import { haversine } from "./geo.js";

// ---------------------------------------------------------------------------
// 1. カテゴリ定義
// ---------------------------------------------------------------------------

export const CATEGORIES = {
  historic: { key: "historic", icon: "🏯", label: "史跡" },
  shrine: { key: "shrine", icon: "⛩️", label: "神社・寺" },
  museum: { key: "museum", icon: "🏛️", label: "博物館・文化施設" },
  culture: { key: "culture", icon: "🗿", label: "歴史・文化スポット" },
  nature: { key: "nature", icon: "🌳", label: "公園・自然" },
};

/** カテゴリキーの配列（UI のフィルタ等で使う想定） */
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

// ---------------------------------------------------------------------------
// 2. 定数
// ---------------------------------------------------------------------------

/** Overpass エンドポイント（先頭から順にフォールバック） */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Overpass の利用規約上、識別可能な User-Agent を送る必要がある */
const USER_AGENT = "Horeki/1.0 (walking-history PWA; +https://github.com/horeki)";

const FETCH_TIMEOUT_MS = 12000; // 1エンドポイントあたりのタイムアウト
const MAX_SPOTS = 60; // 返却する最大件数
const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // キャッシュ有効時間（5分）
const CACHE_MAX_DISTANCE_M = 200; // キャッシュを使い回す移動距離のしきい値
const DEDUPE_DISTANCE_M = 80; // 同名スポットを重複とみなす距離

// ---------------------------------------------------------------------------
// 3. サンプルデータ（フォールバック用・東京多摩川周辺）
// ---------------------------------------------------------------------------

/**
 * ネットワーク不通時などに表示するデモ用データ。
 * 座標は絶対値で保持し、距離は呼び出し時に haversine で算出する。
 */
export const SAMPLE_SPOTS = [
  {
    id: "sample/marukono-watashi",
    name: "丸子の渡し跡",
    category: "historic",
    lat: 35.5804,
    lng: 139.6607,
    description: "かつて多摩川を渡るために利用された渡し場跡。",
    // 「丸子の渡し跡」の記事は無いが「丸子の渡し」はあり、写真も付く
    wikipediaUrl: "https://ja.wikipedia.org/wiki/%E4%B8%B8%E5%AD%90%E3%81%AE%E6%B8%A1%E3%81%97",
    imageUrl: null,
    wikipediaTitle: "丸子の渡し",
    wikipediaLang: "ja",
  },
  {
    id: "sample/tamagawa-sengen",
    name: "多摩川浅間神社",
    category: "shrine",
    lat: 35.5793,
    lng: 139.6669,
    description: "神社。多摩川を見下ろす高台に鎮座し、富士山信仰を伝える。",
    wikipediaUrl: "https://ja.wikipedia.org/wiki/%E5%A4%9A%E6%91%A9%E5%B7%9D%E6%B5%85%E9%96%93%E7%A5%9E%E7%A4%BE",
    imageUrl: null,
    wikipediaTitle: "多摩川浅間神社",
    wikipediaLang: "ja",
  },
  {
    id: "sample/kabutoyama-kofun",
    name: "亀甲山古墳",
    category: "historic",
    lat: 35.5817,
    lng: 139.6673,
    description: "古墳・墓所。多摩川台公園内に残る前方後円墳。",
    wikipediaUrl: "https://ja.wikipedia.org/wiki/%E4%BA%80%E7%94%B2%E5%B1%B1%E5%8F%A4%E5%A2%B3",
    imageUrl: null,
    wikipediaTitle: "亀甲山古墳",
    wikipediaLang: "ja",
  },
  {
    id: "sample/kawasaki-city-museum",
    name: "川崎市市民ミュージアム",
    category: "museum",
    lat: 35.5936,
    lng: 139.6547,
    description: "博物館・美術館。等々力緑地にある市民のための文化施設。",
    wikipediaUrl: "https://ja.wikipedia.org/wiki/%E5%B7%9D%E5%B4%8E%E5%B8%82%E5%B8%82%E6%B0%91%E3%83%9F%E3%83%A5%E3%83%BC%E3%82%B8%E3%82%A2%E3%83%A0",
    imageUrl: null,
    wikipediaTitle: "川崎市市民ミュージアム",
    wikipediaLang: "ja",
  },
  {
    id: "sample/ikegami-honmonji",
    name: "池上本門寺",
    category: "shrine",
    lat: 35.5771,
    lng: 139.6987,
    description: "日蓮宗の寺院。日蓮聖人が入滅した地として知られる。",
    wikipediaUrl: "https://ja.wikipedia.org/wiki/%E6%B1%A0%E4%B8%8A%E6%9C%AC%E9%96%80%E5%AF%BA",
    imageUrl: null,
    wikipediaTitle: "池上本門寺",
    wikipediaLang: "ja",
  },
  {
    id: "sample/tamagawadai-park",
    name: "多摩川台公園",
    category: "nature",
    lat: 35.5825,
    lng: 139.6686,
    description: "公園。多摩川沿いの丘に古墳群が点在する。",
    wikipediaUrl: "https://ja.wikipedia.org/wiki/%E5%A4%9A%E6%91%A9%E5%B7%9D%E5%8F%B0%E5%85%AC%E5%9C%92",
    imageUrl: null,
    wikipediaTitle: "多摩川台公園",
    wikipediaLang: "ja",
  },
  {
    id: "sample/todoroki-valley",
    name: "等々力渓谷",
    category: "nature",
    lat: 35.6046,
    lng: 139.6469,
    description: "自然保護区。23区唯一の渓谷として親しまれている。",
    wikipediaUrl: "https://ja.wikipedia.org/wiki/%E7%AD%89%E3%80%85%E5%8A%9B%E6%B8%93%E8%B0%B7",
    imageUrl: null,
    wikipediaTitle: "等々力渓谷",
    wikipediaLang: "ja",
  },
  {
    id: "sample/kuji-entoubunsui",
    name: "久地円筒分水",
    category: "culture",
    lat: 35.6079,
    lng: 139.6156,
    description: "二ヶ領用水の水を四方に分けた円形の分水施設。（1941年）",
    wikipediaUrl: "https://ja.wikipedia.org/wiki/%E4%B9%85%E5%9C%B0%E5%86%86%E7%AD%92%E5%88%86%E6%B0%B4",
    imageUrl: null,
    wikipediaTitle: "久地円筒分水",
    wikipediaLang: "ja",
  },
];

// ---------------------------------------------------------------------------
// 4. カテゴリ判定（pure）
// ---------------------------------------------------------------------------

const MUSEUM_TOURISM = new Set(["museum", "gallery"]);
const MUSEUM_AMENITY = new Set(["arts_centre", "theatre", "library"]);
const NATURE_LEISURE = new Set(["park", "garden", "nature_reserve"]);
/** historic だけで付けられがちな、実質は寺社にあたる値 */
const WORSHIP_HISTORIC = new Set([
  "wayside_shrine",
  "shrine",
  "temple",
  "church",
  "monastery",
  "chapel",
]);

/**
 * 飲食・物販系の amenity。
 * tourism=attraction が付いていても「歴史や文化に出会う」対象ではないので落とす。
 */
const EXCLUDED_AMENITY = new Set([
  "restaurant",
  "fast_food",
  "cafe",
  "food_court",
  "bar",
  "pub",
  "biergarten",
  "ice_cream",
  "marketplace",
  "nightclub",
]);

/**
 * スポットとして出すべきでない要素かどうか。
 *
 * OSM では商業施設や通路にも観光地扱いの tourism=attraction が付くことがある
 * （例: 東京ラーメンストリート=food_court、東京キャラクターストリート=footway）。
 * ただし historic タグを持つものは歴史的な street や石畳の可能性があるため必ず救済する。
 *
 * @param {Record<string,string>} tags
 * @returns {boolean} true なら結果から除外する
 */
export function isExcluded(tags) {
  const t = tags || {};

  // historic が付いていれば無条件で救済（歴史ある街道・古い商家なども拾いたい）
  if (t.historic) return false;

  // 美術館・ギャラリー等の文化施設も救済する。
  // 画廊は作品を売るため shop=art を併記されることが多く（例: ギャラリー椿）、
  // 物販ルールだけだと本来出したい文化スポットまで消えてしまう。
  if (MUSEUM_TOURISM.has(t.tourism) || MUSEUM_AMENITY.has(t.amenity)) return false;

  // 飲食・物販
  if (EXCLUDED_AMENITY.has(t.amenity)) return true;
  if (t.shop) return true;

  // 通路・線形（footway / pedestrian / path など）はスポットではない
  if (t.highway) return true;

  return false;
}

/**
 * OSM タグから 5 カテゴリのいずれかを判定する。
 * 優先順位: 礼拝所 > 博物館系 > historic > 公園・自然 > その他文化
 * @param {Record<string,string>} tags
 * @returns {"historic"|"shrine"|"museum"|"culture"|"nature"}
 */
export function classifySpot(tags) {
  const t = tags || {};

  // 1. 神社・寺・教会（religion 問わず）
  if (t.amenity === "place_of_worship") return "shrine";
  // 稲荷社・祠のたぐいは amenity が付かず historic だけのことが多い。
  // 名前が「〜神社」なのに 🏯 が出ると違和感が強いので、ここで寺社に寄せる。
  if (WORSHIP_HISTORIC.has(t.historic)) return "shrine";

  // 2. 博物館・文化施設
  if (MUSEUM_TOURISM.has(t.tourism)) return "museum";
  if (MUSEUM_AMENITY.has(t.amenity)) return "museum";

  // 3. 史跡（historic タグがあれば）
  if (t.historic) return "historic";

  // 4. 公園・自然
  if (NATURE_LEISURE.has(t.leisure)) return "nature";
  if (t.natural) return "nature";

  // 5. それ以外（tourism=artwork / attraction など）
  return "culture";
}

// ---------------------------------------------------------------------------
// 5. 説明文の生成（pure）
// ---------------------------------------------------------------------------

/** historic=* の値 → 日本語説明 */
const HISTORIC_DESC = {
  castle: "城跡・城郭。",
  fort: "砦・要塞の跡。",
  city_gate: "城門の跡。",
  gate: "歴史ある門。",
  monument: "記念碑・モニュメント。",
  memorial: "記念碑。",
  ruins: "遺構・廃墟。",
  archaeological_site: "遺跡。",
  tomb: "古墳・墓所。",
  wayside_shrine: "道ばたの祠。",
  wayside_cross: "路傍の十字架。",
  boundary_stone: "境界石。土地の境を示した古い石標。",
  milestone: "里程標。道のりを示した古い標石。",
  stone: "歴史ある石碑。",
  church: "歴史ある教会堂。",
  temple: "歴史ある寺院。",
  monastery: "歴史ある修道院。",
  manor: "歴史ある邸宅・館。",
  farm: "歴史ある農家建築。",
  house: "歴史ある住宅建築。",
  building: "歴史的建造物。",
  bridge: "歴史ある橋。",
  well: "古井戸。",
  mine: "鉱山跡。",
  tower: "歴史ある塔。",
  battlefield: "古戦場。",
  aircraft: "保存展示されている歴史的な航空機。",
  ship: "保存展示されている歴史的な船舶。",
  locomotive: "保存展示されている蒸気機関車。",
  railway_car: "保存展示されている鉄道車両。",
  cannon: "歴史的な大砲。",
  district: "歴史的な町並みが残る一帯。",
  heritage: "史跡。",
  yes: "史跡。",
};

/** tourism=* の値 → 日本語説明 */
const TOURISM_DESC = {
  museum: "博物館・美術館。",
  gallery: "ギャラリー・美術展示施設。",
  artwork: "屋外に置かれたアート作品。",
  attraction: "見どころとして知られるスポット。",
  viewpoint: "眺望スポット。",
  information: "案内板・観光案内。",
};

/** tourism=artwork のときの artwork_type → 日本語説明 */
const ARTWORK_DESC = {
  statue: "彫像。",
  sculpture: "彫刻作品。",
  bust: "胸像。",
  mural: "壁画。",
  relief: "レリーフ（浮き彫り）。",
  installation: "インスタレーション作品。",
  stone: "石造のモニュメント。",
};

/** amenity=* の値 → 日本語説明 */
const AMENITY_DESC = {
  arts_centre: "アートセンター・文化施設。",
  theatre: "劇場・ホール。",
  library: "図書館。",
  fountain: "噴水。",
  townhall: "役場・庁舎。",
};

/** leisure=* の値 → 日本語説明 */
const LEISURE_DESC = {
  park: "公園。",
  garden: "庭園。",
  nature_reserve: "自然保護区。",
};

/** natural=* の値 → 日本語説明 */
const NATURAL_DESC = {
  tree: "名木・巨木。",
  water: "水辺。",
  spring: "湧水地。",
  peak: "山頂。",
  wood: "樹林地。",
  rock: "巨石・奇岩。",
  stone: "巨石。",
  beach: "浜辺。",
  cliff: "崖。",
};

/** religion=buddhist のときの denomination → 宗派名 */
const BUDDHIST_DENOMINATION = {
  jodo_shu: "浄土宗",
  jodo_shinshu: "浄土真宗",
  shingon_shu: "真言宗",
  nichiren_shu: "日蓮宗",
  soto_zen: "曹洞宗",
  soto: "曹洞宗",
  rinzai: "臨済宗",
  rinzai_zen: "臨済宗",
  tendai: "天台宗",
  obaku: "黄檗宗",
  ji_shu: "時宗",
  hokke: "法華宗",
  zen: "禅宗",
};

/** religion=christian のときの denomination → 教会種別 */
const CHRISTIAN_DENOMINATION = {
  catholic: "カトリック教会。",
  roman_catholic: "カトリック教会。",
  protestant: "プロテスタント教会。",
  anglican: "聖公会の教会。",
  orthodox: "正教会。",
  baptist: "バプテスト教会。",
  lutheran: "ルーテル教会。",
};

/** 礼拝所（amenity=place_of_worship）の説明を religion から作る */
function worshipDescription(tags) {
  switch (tags.religion) {
    case "shinto":
      return "神社。地域の鎮守として親しまれている場所。";
    case "buddhist": {
      const sect = BUDDHIST_DENOMINATION[tags.denomination];
      return sect ? `${sect}の寺院。` : "寺院。";
    }
    case "christian":
      return CHRISTIAN_DENOMINATION[tags.denomination] || "教会。";
    case "muslim":
      return "モスク（イスラムの礼拝所）。";
    case "jewish":
      return "シナゴーグ（ユダヤ教の礼拝所）。";
    case "taoist":
      return "道教の廟。";
    case "confucian":
      return "儒教の廟。";
    default:
      return "寺社・礼拝所。";
  }
}

/**
 * start_date などから「年」を取り出す。取れなければ null。
 * "1603", "1603-05", "C18", "~1750" などが来るので数字4桁（または3桁）だけ拾う。
 */
function extractYear(tags) {
  const raw = tags["start_date"] || tags["建立年"] || tags["year_of_construction"];
  if (!raw) return null;
  const m = String(raw).match(/\d{3,4}/);
  if (!m) return null;
  const year = Number(m[0]);
  if (year < 300 || year > 2100) return null;
  return year;
}

/**
 * OSM タグから日本語1文の説明を作る。
 * 優先順位: description:ja > description > inscription > タグからの組み立て
 * @param {Record<string,string>} tags
 * @param {string} [category] classifySpot() の結果（省略時は内部で判定）
 * @returns {string}
 */
export function buildDescription(tags, category) {
  const t = tags || {};
  const cat = category || classifySpot(t);

  // 1. 既存の説明文があればそのまま使う
  const given = t["description:ja"] || t.description;
  if (given && given.trim()) return given.trim();

  // 2. 碑文があればそれを説明として使う
  const inscription = t["inscription:ja"] || t.inscription;
  if (inscription && inscription.trim()) return inscription.trim();

  // 3. タグから組み立てる
  let base = null;
  if (t.amenity === "place_of_worship") {
    base = worshipDescription(t);
  } else if (t.tourism === "artwork" && ARTWORK_DESC[t.artwork_type]) {
    base = ARTWORK_DESC[t.artwork_type];
  } else if (MUSEUM_TOURISM.has(t.tourism)) {
    // tourism=museum|gallery は具体的なので historic より優先（歴史的建造物の博物館対策）
    base = TOURISM_DESC[t.tourism];
  } else if (t.amenity && AMENITY_DESC[t.amenity]) {
    base = AMENITY_DESC[t.amenity];
  } else if (t.historic && HISTORIC_DESC[t.historic]) {
    // historic=memorial などの具体的な値を、
    // tourism=attraction のような漠然としたタグより先に評価する。
    // （例: 動輪の広場は historic=memorial + tourism=attraction → 「記念碑。」）
    base = HISTORIC_DESC[t.historic];
  } else if (t.tourism && TOURISM_DESC[t.tourism]) {
    base = TOURISM_DESC[t.tourism];
  } else if (t.leisure && LEISURE_DESC[t.leisure]) {
    base = LEISURE_DESC[t.leisure];
  } else if (t.natural && NATURAL_DESC[t.natural]) {
    base = NATURAL_DESC[t.natural];
  }

  // 知らない値はカテゴリ名で汎用フォールバック
  if (!base) {
    const label = (CATEGORIES[cat] || CATEGORIES.culture).label;
    base = `${label}。`;
  }

  // 4. 年代が分かればひとこと添える（やりすぎない）
  const year = extractYear(t);
  if (year) {
    const suffix = cat === "shrine" || cat === "historic" ? `（${year}年建立）` : `（${year}年）`;
    base += suffix;
  }

  return base;
}

// ---------------------------------------------------------------------------
// 6. 画像 URL の生成（pure・APIを叩かない）
// ---------------------------------------------------------------------------

/** Commons の画像直リンクを作るためのエンドポイント */
const COMMONS_FILEPATH = "https://commons.wikimedia.org/wiki/Special:FilePath/";

/** サムネイル幅。カード表示に十分で、転送量を抑えられる値 */
const IMAGE_WIDTH = 400;

/**
 * image タグに入っていても <img> では表示できない共有ページのホスト。
 * 実データ調査で Google フォトの共有リンクが多数見つかったが、
 * これらは content-type が text/html で画像ではない。
 * URL を返してしまうと Wikipedia 由来の画像を取りにいく機会を潰すので落とす。
 */
const NON_IMAGE_HOSTS = [
  "photos.app.goo.gl",
  "photos.google.com",
  "goo.gl",
  "flic.kr",
  "www.flickr.com",
  "flickr.com",
  "www.instagram.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "www.facebook.com",
  "facebook.com",
];

/**
 * Commons のファイル名から画像直リンクを作る。
 * "File:" / "ファイル:" プレフィックスは除去する。
 * @param {string} file
 * @returns {string|null}
 */
function commonsFilePath(file) {
  const name = String(file || "")
    .trim()
    .replace(/^(File|Image|ファイル):/i, "")
    .trim()
    .replace(/ /g, "_");
  if (!name) return null;
  return `${COMMONS_FILEPATH}${encodeURIComponent(name)}?width=${IMAGE_WIDTH}`;
}

/** 表示できる見込みのある画像 URL か（共有ページを除外する） */
function isRenderableImageUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !NON_IMAGE_HOSTS.includes(host);
  } catch {
    return false;
  }
}

/**
 * OSM タグから、そのまま <img src> に入れられる画像 URL を作る。
 * API を叩かない同期の純関数。
 *
 * 優先順位:
 *  1. image タグ（http は https に書き換え。Commons のファイルページ URL や
 *     "File:Foo.jpg" 形式は直リンクへ変換する）
 *  2. wikimedia_commons タグ（Category: は画像ではないので null）
 *
 * @param {Record<string,string>} tags
 * @returns {string|null}
 */
export function buildImageUrl(tags) {
  const t = tags || {};
  const raw = (t.image || "").trim();

  if (raw) {
    // commons のファイルページ URL は画像ではないので直リンクへ変換する
    // 例: https://commons.wikimedia.org/wiki/File:Sensoji_2023.jpg
    const page = raw.match(
      /^https?:\/\/commons\.wikimedia\.org\/wiki\/(?:File|ファイル):(.+)$/i
    );
    if (page) {
      let name = page[1];
      try {
        name = decodeURIComponent(name);
      } catch {
        /* 壊れたエスケープはそのまま使う */
      }
      return commonsFilePath(name);
    }

    // 既に直リンク（Special:FilePath / upload.wikimedia.org）ならそのまま。
    // 表示できない共有ページだった場合は null を返さず、下の
    // wikimedia_commons へ処理を落とす（写真が出る可能性を潰さないため）。
    if (/^https?:\/\//i.test(raw)) {
      if (isRenderableImageUrl(raw)) {
        // GitHub Pages は https 配信なので http のままだと mixed content で弾かれる
        return raw.replace(/^http:\/\//i, "https://");
      }
    } else if (/^(File|ファイル):/i.test(raw)) {
      // URL ではなく "File:Foo.jpg" のようなファイル名が入っているケース
      return commonsFilePath(raw);
    }
  }

  const commons = (t.wikimedia_commons || "").trim();
  // Category: は画像そのものではないので使わない
  if (commons && !/^(Category|カテゴリ):/i.test(commons)) {
    return commonsFilePath(commons);
  }

  return null;
}

// ---------------------------------------------------------------------------
// 7. Wikipedia / Wikidata URL の生成（pure）
// ---------------------------------------------------------------------------

/**
 * OSM タグから閲覧用の Wikipedia / Wikidata URL を作る。
 * - wikipedia=ja:浅草寺 → https://ja.wikipedia.org/wiki/浅草寺
 * - wikipedia:ja=浅草寺 も同様に扱う
 * - 言語プレフィックスが無ければ ja とみなす
 * - wikipedia が無く wikidata だけある場合は wikidata の URL
 * @param {Record<string,string>} tags
 * @returns {string|null}
 */
/**
 * wikipedia 系タグを { lang, title } に分解する。
 * buildWikipediaUrl と fetchSpotMedia の両方から使う。
 * @param {Record<string,string>} tags
 * @returns {{lang: string, title: string}|null}
 */
export function parseWikipediaRef(tags) {
  const t = tags || {};

  if (t.wikipedia && t.wikipedia.trim()) {
    const raw = t.wikipedia.trim();
    const idx = raw.indexOf(":");
    const maybeLang = idx > 0 ? raw.slice(0, idx) : "";
    if (idx > 0 && /^[a-z]{2,3}(-[a-z0-9-]+)?$/i.test(maybeLang)) {
      const title = raw.slice(idx + 1).trim();
      return title ? { lang: maybeLang.toLowerCase(), title } : null;
    }
    return { lang: "ja", title: raw };
  }

  // wikipedia:ja=... 形式
  const key = Object.keys(t).find((k) => /^wikipedia:[a-z]{2,3}(-[a-z0-9-]+)?$/i.test(k));
  if (key && t[key] && t[key].trim()) {
    return { lang: key.slice("wikipedia:".length).toLowerCase(), title: t[key].trim() };
  }

  return null;
}

/**
 * wikidata タグから QID を取り出す。
 * @param {Record<string,string>} tags
 * @returns {string|null}
 */
export function parseWikidataId(tags) {
  const qid = ((tags || {}).wikidata || "").trim();
  return /^Q\d+$/.test(qid) ? qid : null;
}

export function buildWikipediaUrl(tags) {
  const ref = parseWikipediaRef(tags);

  if (ref) {
    const path = encodeURIComponent(ref.title.replace(/ /g, "_"));
    return `https://${ref.lang}.wikipedia.org/wiki/${path}`;
  }

  // Wikidata へのフォールバック
  const qid = parseWikidataId(tags);
  return qid ? `https://www.wikidata.org/wiki/${qid}` : null;
}

// ---------------------------------------------------------------------------
// 8. Overpass クエリの組み立て（pure）
// ---------------------------------------------------------------------------

/**
 * 指定地点まわりの「歴史・文化」系 OSM 要素を取る Overpass QL を作る。
 * node / way / relation すべてを対象にし、out center で中心座標を得る。
 *
 * out に件数上限を付けないのは意図的。上限を付けると Overpass は
 * 「距離が近い順」ではなく任意の順で切ってしまうため、呼ぶたびに結果が変わり、
 * 浅草寺や雷門のような主要スポットが不定期に消える（実測で確認済み）。
 * 範囲は radius で絞れており、最も重い浅草 radius=1500 でも 644件・152KB 程度。
 */
export function buildOverpassQuery(lat, lng, radius) {
  const r = Math.round(radius);
  const at = `${r},${lat},${lng}`;
  return `[out:json][timeout:20];
(
  nwr["historic"](around:${at});
  nwr["amenity"="place_of_worship"](around:${at});
  nwr["tourism"~"^(museum|artwork|attraction|gallery)$"](around:${at});
  nwr["amenity"~"^(arts_centre|theatre|library)$"](around:${at});
  nwr["leisure"~"^(park|garden)$"](around:${at});
  nwr["natural"="tree"]["name"](around:${at});
);
out tags center;`;
}

// ---------------------------------------------------------------------------
// 9. Overpass レスポンスの正規化（pure）
// ---------------------------------------------------------------------------

/** 要素の中心座標を取り出す（node は lat/lon、way/relation は center） */
function elementCoords(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === "number") {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

/** 表示名を取り出す（日本語名を優先） */
function pickName(tags) {
  const name = tags["name:ja"] || tags.name;
  return name && name.trim() ? name.trim() : null;
}

/**
 * Overpass の elements 配列を、アプリで使う spot 配列へ変換する。
 * 名前の無い要素・飲食物販・通路は除外し、distance 昇順でソートして返す。
 * 重複排除はカテゴリ枠の調整（trimToLimit）より前に行い、重複が枠を食わないようにする。
 * @param {Array} elements
 * @param {number} lat 現在地
 * @param {number} lng 現在地
 * @returns {Array}
 */
export function normalizeElements(elements, lat, lng) {
  const spots = [];

  for (const el of elements || []) {
    const tags = el.tags || {};
    const name = pickName(tags);
    if (!name) continue; // 名前不明は出さない
    if (isExcluded(tags)) continue; // 飲食店・物販・通路は出さない

    const coords = elementCoords(el);
    if (!coords) continue;

    const category = classifySpot(tags);
    const ref = parseWikipediaRef(tags);
    spots.push({
      id: `${el.type}/${el.id}`,
      name,
      category,
      lat: coords.lat,
      lng: coords.lng,
      distance: Math.round(haversine(lat, lng, coords.lat, coords.lng)),
      description: buildDescription(tags, category),
      wikipediaUrl: buildWikipediaUrl(tags),
      // 写真まわり（fetchSpotMedia が使う）
      imageUrl: buildImageUrl(tags),
      wikipediaTitle: ref ? ref.title : null,
      wikipediaLang: ref ? ref.lang : null,
    });
  }

  spots.sort((a, b) => a.distance - b.distance);
  return trimToLimit(dedupe(spots));
}

/**
 * 60件に絞り込む。
 * 単純に近い順で切ると、数の多い公園（nature）だけで枠が埋まり、
 * 肝心の史跡・寺社が押し出されてしまうため、nature の枠を上限の 1/3 までに抑える。
 * 絞り込んだあとも距離の昇順は保つ。
 * @param {Array} sortedSpots 距離昇順のスポット配列
 */
function trimToLimit(sortedSpots) {
  if (sortedSpots.length <= MAX_SPOTS) return sortedSpots;

  const natureLimit = Math.floor(MAX_SPOTS / 3);
  const history = [];
  const nature = [];
  for (const s of sortedSpots) {
    (s.category === "nature" ? nature : history).push(s);
  }

  // 歴史・文化系を優先で埋め、残り枠を近い公園で埋める
  const picked = history.slice(0, MAX_SPOTS - Math.min(nature.length, natureLimit));
  picked.push(...nature.slice(0, MAX_SPOTS - picked.length));

  return picked.sort((a, b) => a.distance - b.distance);
}

/**
 * 同じ場所が node / way の両方で、あるいは複数の way に分割して登録されている
 * ケースをまとめる。
 *
 * 判定: 表示名（name:ja 優先・前後空白除去済み）が一致し、かつ相互の距離が 80m 以内。
 * 残すもの: 現在地から最も近い1件。
 *   引数が距離の昇順である前提なので、先に kept へ入ったものが常に最も近い。
 * 距離を条件に入れているのは、離れた場所にある同名の神社（稲荷神社など）を
 * 誤って1件に潰さないため。
 *
 * @param {Array} sortedSpots 距離昇順のスポット配列
 */
function dedupe(sortedSpots) {
  const kept = [];
  for (const spot of sortedSpots) {
    const dup = kept.some(
      (k) =>
        k.name === spot.name &&
        haversine(k.lat, k.lng, spot.lat, spot.lng) <= DEDUPE_DISTANCE_M
    );
    if (!dup) kept.push(spot);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// 10. サンプルデータのフォールバック（pure）
// ---------------------------------------------------------------------------

/**
 * サンプルスポットに現在地からの距離を付けて返す。
 * 現在地がどれだけ離れていても必ず全件返す（デモデータとして見せるため）。
 */
export function sampleSpotsFrom(lat, lng) {
  return SAMPLE_SPOTS.map((s) => ({
    ...s,
    distance: Math.round(haversine(lat, lng, s.lat, s.lng)),
  })).sort((a, b) => a.distance - b.distance);
}

// ---------------------------------------------------------------------------
// 11. fetch まわり（signal 合成・タイムアウト）
// ---------------------------------------------------------------------------

/** abort 由来のエラーかどうか */
function isAbortError(err) {
  return !!err && (err.name === "AbortError" || err.name === "TimeoutError");
}

/**
 * 呼び出し側の signal と、内部タイムアウトを合成した AbortController を作る。
 * 戻り値の cleanup() で必ずリスナー・タイマーを解放すること。
 */
function makeCombinedSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort(new DOMException("Overpass request timed out", "TimeoutError"));
  }, timeoutMs);

  const onExternalAbort = () => controller.abort(externalSignal.reason);

  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    },
  };
}

/** 1つのエンドポイントへ問い合わせる。失敗時は例外を投げる。 */
async function queryEndpoint(endpoint, query, externalSignal, timeoutMs) {
  const { signal, cleanup } = makeCombinedSignal(externalSignal, timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        // Overpass は UA なしのリクエストを弾く。
        // ブラウザでは禁止ヘッダとして無視されるだけなので CORS preflight は発生しない。
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal,
    });

    if (!res.ok) {
      const err = new Error(`Overpass ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json();
    if (!json || !Array.isArray(json.elements)) {
      throw new Error("Overpass returned an unexpected payload");
    }
    return json.elements;
  } finally {
    cleanup();
  }
}

/** HTTP ステータス等から、ユーザーに見せる日本語メッセージを作る */
function userMessageFor(err) {
  if (err && err.name === "TimeoutError") {
    return "スポット情報の取得に時間がかかっています（電波の弱い場所かもしれません）";
  }
  if (err && err.status === 429) {
    return "アクセスが集中しています。少し時間をおいてお試しください";
  }
  if (err && typeof err.status === "number" && err.status >= 500) {
    return "地図サーバーが混み合っています。しばらくしてからお試しください";
  }
  return "スポット情報を取得できませんでした（オフラインの可能性）";
}

// ---------------------------------------------------------------------------
// 12. スポットのキャッシュ
// ---------------------------------------------------------------------------

/** 直近の取得結果（メモリ内・1件のみ保持） */
let cache = null;

/** キャッシュを破棄する */
export function clearSpotsCache() {
  cache = null;
}

/** キャッシュが今の地点で使えるか */
function cacheIsFresh(lat, lng, radius) {
  if (!cache) return false;
  if (cache.radius !== radius) return false;
  if (Date.now() - cache.at > CACHE_MAX_AGE_MS) return false;
  return haversine(cache.lat, cache.lng, lat, lng) <= CACHE_MAX_DISTANCE_M;
}

/** キャッシュされたスポットに、現在地基準の距離を付け直す */
function rehydrate(spots, lat, lng) {
  return spots
    .map((s) => ({ ...s, distance: Math.round(haversine(lat, lng, s.lat, s.lng)) }))
    .sort((a, b) => a.distance - b.distance);
}

// ---------------------------------------------------------------------------
// 13. メイン関数
// ---------------------------------------------------------------------------

/**
 * 現在地の周辺スポットを取得する。
 *
 * @param {number} lat 現在地の緯度
 * @param {number} lng 現在地の経度
 * @param {{radius?: number, signal?: AbortSignal, timeoutMs?: number}} [options]
 *   timeoutMs は1エンドポイントあたりの待ち時間。全滅すると
 *   エンドポイント数 × timeoutMs だけ待たされるので、UI 側で短くしてもよい。
 * @returns {Promise<{spots: Array, source: "overpass"|"sample", error: string|null}>}
 *
 * 失敗しても例外は投げず、サンプルデータへフォールバックする。
 * ただし呼び出し側の signal による abort だけはそのまま再 throw する。
 */
export async function fetchNearbySpots(
  lat,
  lng,
  { radius = 1500, signal, timeoutMs = FETCH_TIMEOUT_MS } = {}
) {
  // ユーザー起因の abort は素直に投げ返す
  if (signal && signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Aborted", "AbortError");
  }

  // 直近と同じ場所ならキャッシュを返す（距離だけ計算し直す）
  if (cacheIsFresh(lat, lng, radius)) {
    return {
      spots: rehydrate(cache.spots, lat, lng),
      source: cache.source,
      error: cache.error,
    };
  }

  const query = buildOverpassQuery(lat, lng, radius);
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const elements = await queryEndpoint(endpoint, query, signal, timeoutMs);
      const spots = normalizeElements(elements, lat, lng);

      // 0件でもサンプルにはフォールバックしない（「近くにありません」を出したいため）
      cache = { lat, lng, radius, at: Date.now(), spots, source: "overpass", error: null };
      return { spots, source: "overpass", error: null };
    } catch (err) {
      // 呼び出し側が中断したなら、フォールバックせずに abort を伝播させる
      if (signal && signal.aborted) throw err;
      lastError = err;
      if (isAbortError(err)) {
        console.warn(`[spots] ${endpoint} がタイムアウトしました`);
      } else {
        console.warn(`[spots] ${endpoint} への問い合わせに失敗しました: ${err.message}`);
      }
    }
  }

  // 全エンドポイントが駄目だったのでサンプルを返す
  const spots = sampleSpotsFrom(lat, lng);
  const error = userMessageFor(lastError);
  cache = { lat, lng, radius, at: Date.now(), spots: SAMPLE_SPOTS, source: "sample", error };
  return { spots, source: "sample", error };
}

// ---------------------------------------------------------------------------
// 14. スポットの写真・要約の取得（Wikipedia / Wikidata・APIキー不要）
// ---------------------------------------------------------------------------

const MEDIA_TIMEOUT_MS = 6000;

/** 一時的な失敗（429・5xx・通信断）を再試行するまでの待ち時間 */
const MEDIA_RETRY_COOLDOWN_MS = 60 * 1000;

/**
 * スポットごとの取得結果。キーは spot.id。
 * 値は { imageUrl, extract, source, retryAt }。
 * retryAt が無ければ恒久的な結果（成功 or 記事なし）で、二度と取りにいかない。
 */
const mediaCache = new Map();

/** 写真・要約のキャッシュを破棄する */
export function clearMediaCache() {
  mediaCache.clear();
}

/** 画像なしの戻り値 */
const EMPTY_MEDIA = { imageUrl: null, extract: null, source: null };

/** wikipediaUrl から言語とタイトルを復元する（wikipediaTitle が無い spot 用） */
function refFromWikipediaUrl(url) {
  if (!url) return null;
  const m = String(url).match(/^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/i);
  if (!m) return null;
  try {
    return { lang: m[1].toLowerCase(), title: decodeURIComponent(m[2]).replace(/_/g, " ") };
  } catch {
    return null;
  }
}

/** wikipediaUrl が wikidata を指している場合に QID を取り出す */
function qidFromUrl(url) {
  const m = String(url || "").match(/^https?:\/\/www\.wikidata\.org\/wiki\/(Q\d+)$/i);
  return m ? m[1] : null;
}

/** タイムアウト付きの GET。失敗時は status 付きの例外を投げる。 */
async function getJson(url, externalSignal) {
  const { signal, cleanup } = makeCombinedSignal(externalSignal, MEDIA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal,
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    cleanup();
  }
}

/**
 * Wikipedia REST API のサマリから画像と要約を取る。
 * キー不要・CORS 許可済み（Access-Control-Allow-Origin: *）。
 */
async function fetchWikipediaSummary(lang, title, signal) {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title.replace(/ /g, "_")
  )}`;
  const json = await getJson(url, signal);

  // 曖昧さ回避ページは中身が無いので画像も要約も使わない
  if (json.type === "disambiguation") return { imageUrl: null, extract: null };

  return {
    imageUrl: json.thumbnail?.source || json.originalimage?.source || null,
    extract: json.extract && json.extract.trim() ? json.extract.trim() : null,
  };
}

/**
 * Wikidata の P18（画像）から Commons の直リンクを作る。
 * Special:EntityData も CORS 許可済み。
 */
async function fetchWikidataImage(qid, signal) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const json = await getJson(url, signal);
  const file = json.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return file ? commonsFilePath(file) : null;
}

/** 一時的な失敗か（時間をおけば直る見込みがあるか） */
function isTransient(err) {
  if (!err) return false;
  if (err.name === "TimeoutError") return true;
  if (err.status === 429) return true;
  if (typeof err.status === "number") return err.status >= 500;
  return true; // 通信断などは一時的とみなす
}

/**
 * スポットの写真と要約を取得する。
 *
 * - タグ由来の画像があれば API を叩かず即返す（source: "tag"）
 * - wikipedia / wikidata のどちらも無いスポットは **リクエストを出さずに** 即返す
 * - 失敗しても例外は投げず null を返す（写真は無くても致命的ではない）
 * - 同じスポットは二度取りにいかない（失敗もキャッシュする）
 *
 * @param {object} spot fetchNearbySpots が返す spot
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{imageUrl: string|null, extract: string|null, source: "tag"|"wikipedia"|null}>}
 */
export async function fetchSpotMedia(spot, { signal } = {}) {
  if (!spot) return EMPTY_MEDIA;

  // 1. タグから作れているならネットワークは使わない
  if (spot.imageUrl) {
    return { imageUrl: spot.imageUrl, extract: null, source: "tag" };
  }

  // 2. 参照先を決める（wikipediaTitle 優先、無ければ wikipediaUrl から復元）
  const fromUrl = refFromWikipediaUrl(spot.wikipediaUrl);
  const title = spot.wikipediaTitle || fromUrl?.title || null;
  const lang = spot.wikipediaLang || fromUrl?.lang || "ja";
  const qid = qidFromUrl(spot.wikipediaUrl);

  // 手がかりが無いならリクエストを出さない
  if (!title && !qid) return EMPTY_MEDIA;

  // 3. キャッシュ（失敗もキャッシュして無限リトライを防ぐ）
  const key = spot.id || `${lang}:${title || qid}`;
  const hit = mediaCache.get(key);
  if (hit && (!hit.retryAt || hit.retryAt > Date.now())) {
    return { imageUrl: hit.imageUrl, extract: hit.extract, source: hit.source };
  }

  let result = EMPTY_MEDIA;
  let err = null;

  try {
    if (title) {
      const { imageUrl, extract } = await fetchWikipediaSummary(lang, title, signal);
      result = { imageUrl, extract, source: imageUrl || extract ? "wikipedia" : null };
    } else if (qid) {
      const imageUrl = await fetchWikidataImage(qid, signal);
      result = { imageUrl, extract: null, source: imageUrl ? "wikipedia" : null };
    }
  } catch (e) {
    // ユーザー起因の中断だけは呼び出し側に伝える
    if (signal && signal.aborted) throw e;
    err = e;
    result = EMPTY_MEDIA;
  }

  // 一時的な失敗は少し待って再挑戦できるようにする。
  // 404（記事なし）や成功は恒久的な結果として覚える。
  mediaCache.set(key, {
    ...result,
    ...(err && isTransient(err) ? { retryAt: Date.now() + MEDIA_RETRY_COOLDOWN_MS } : {}),
  });

  return result;
}
