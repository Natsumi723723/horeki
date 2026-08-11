// アプリ名はここだけ変えれば全部に反映される（index.html の <title> を除く）。
// vite.config.js からも読まれ、PWA マニフェストに流し込まれる。
export const APP_NAME = "歩歴";
export const APP_NAME_EN = "Horeki";
export const APP_READING = "ほれき";
export const APP_TAGLINE = "歩いた道が、自分の地図になる";

// IndexedDB の名前。**絶対に変更しないこと。**
// 変えると既存ユーザーの歩行記録が読めなくなる。
export const DB_NAME = "horeki";
// v2: チェックイン（checkins）ストアを追加。
// バージョンを上げるときは db.js の upgrade を「追加のみ」にすること。
// 既存ストアを作り直すと過去の歩行記録が消える。
export const DB_VERSION = 2;
