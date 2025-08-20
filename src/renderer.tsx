import React from "react";
import * as Sentry from "@sentry/electron/renderer";
import { createRoot } from "react-dom/client";
import App from "./components/App";
import Onboarding from "./components/Onboarding";
import { HashRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import { initMicDevicesBridge } from "./utils/micDevices";

// Initialize microphone devices bridge early
initMicDevicesBridge();

// Initialize Sentry in the renderer
Sentry.init({
  dsn: "https://1988d4ea27135775fc8653d6f9c11701@o4509875043565568.ingest.us.sentry.io/4509875045007360",
});

// Dev helper: expose a function to trigger an error to verify Sentry
if (import.meta.env.DEV) {
  (window as any).triggerSentryError = () => {
    // Intentionally call an undefined function to throw
    (window as any).myUndefinedFunction();
  };
}

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
