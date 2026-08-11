import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

async function boot() {
  // 開発時に ?mock=walk を付けたときだけ、歩行シミュレータを差し込む。
  // 本番ビルドではこのブロックごと消える。
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
    const m = await import("./mockGeo.js");
    m.installMockGeolocation();
  }
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

boot();
