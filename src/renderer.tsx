import React from "react";
import { createRoot } from "react-dom/client";
import App from "./components/App";
import Onboarding from "./components/Onboarding";
import { HashRouter, Routes, Route } from "react-router-dom";
import "./index.css";

function mountReact(root: HTMLElement) {
  const reactRoot = createRoot(root);
  reactRoot.render(
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/onboarding" element={<Onboarding />} />
      </Routes>
    </HashRouter>,
  );
}

// Add a temporary class to body to avoid any first-paint flash
try {
  document.body.classList.add("initial-fade");
} catch {}

const existing = document.getElementById("root");
if (existing) {
  mountReact(existing);
} else {
  const created = document.createElement("div");
  created.id = "root";
  document.body.appendChild(created);
  mountReact(created);
}

// Signal main after the first frame. Fonts use font-display: swap, so waiting
// on document.fonts.ready can turn a slow font load into a hidden black window.
requestAnimationFrame(() => {
  try {
    window.electron?.rendererReady?.();
  } catch {}
  try {
    document.body.classList.remove("initial-fade");
  } catch {}
});

console.log("🎤 Spoke is running");
