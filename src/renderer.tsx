import React from "react";
import { createRoot } from "react-dom/client";
import App from "./components/App";
import Onboarding from "./components/Onboarding";
import { HashRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import { initMicDevicesBridge } from "./utils/micDevices";

// Initialize microphone devices bridge early
initMicDevicesBridge();

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

const existing = document.getElementById("root");
if (existing) {
  mountReact(existing);
} else {
  const created = document.createElement("div");
  created.id = "root";
  document.body.appendChild(created);
  mountReact(created);
}

console.log("🎤 Sonic Flow is running");
