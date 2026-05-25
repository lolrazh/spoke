import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import "./index.css";

window.electron?.bootMark?.("module-loaded");

const App = lazy(() => {
  window.electron?.bootMark?.("route:app-import:start");
  return import("./components/App").then((module) => {
    window.electron?.bootMark?.("route:app-import:done");
    return module;
  });
});

const Onboarding = lazy(() => {
  window.electron?.bootMark?.("route:onboarding-import:start");
  return import("./components/Onboarding").then((module) => {
    window.electron?.bootMark?.("route:onboarding-import:done");
    return module;
  });
});

function mountReact(root: HTMLElement) {
  window.electron?.bootMark?.("react-render:start");
  const reactRoot = createRoot(root);
  reactRoot.render(
    <HashRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/onboarding" element={<Onboarding />} />
        </Routes>
      </Suspense>
    </HashRouter>,
  );
  window.electron?.bootMark?.("react-render:scheduled");
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
  window.electron?.bootMark?.("first-animation-frame");
});

console.log("🎤 Spoke is running");
