import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { APP_NAME, APP_TAGLINE } from "./src/config.js";

// base: "./" — GitHub Pages のプロジェクトサイト(/repo-name/)でも
// そのまま動く相対パス構成。リポジトリ名に依存しない。
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      // 新しいビルドを配信したら次回起動で必ず入れ替わる。
      // キャッシュ優先にすると、デプロイしても永久に古い画面が出続ける。
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        runtimeCaching: [
          {
            // 地図タイルだけはキャッシュ優先。一度通った道はオフラインでも地図が出る。
            urlPattern: /^https:\/\/(?:[a-c]\.)?tile\.openstreetmap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 1200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // スポット検索はオンライン時のみ。古い結果を返さない。
            urlPattern: /^https:\/\/.*\/api\/interpreter/i,
            handler: "NetworkOnly",
          },
        ],
      },
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_TAGLINE,
        lang: "ja",
        display: "standalone",
        orientation: "portrait",
        start_url: ".",
        scope: ".",
        theme_color: "#FAF8F2",
        background_color: "#243447",
        categories: ["travel", "navigation", "lifestyle"],
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
});
