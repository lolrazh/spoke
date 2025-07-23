import React from "react";
import { createRoot } from "react-dom/client";
import App from "./components/App";
import Onboarding from "./components/Onboarding";
import { HashRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import { initMicDevicesBridge } from "./utils/micDevices";

// Initialize microphone devices bridge early
initMicDevicesBridge();

// Create root element
const rootElement = document.getElementById("root");

if (!rootElement) {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);

  const reactRoot = createRoot(root);
  reactRoot.render(
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/onboarding" element={<Onboarding />} />
      </Routes>
    </HashRouter>,
  );
} else {
  const reactRoot = createRoot(rootElement);
  reactRoot.render(
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/onboarding" element={<Onboarding />} />
      </Routes>
    </HashRouter>,
  );
}

console.log("🎤 Sonic Flow is running");
