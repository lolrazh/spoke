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
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // Default to 'prod' for packaged builds and 'dev' for development
  environment:
    import.meta.env.VITE_SENTRY_ENVIRONMENT ||
    (import.meta.env.DEV ? "dev" : "prod"),
  // Enable performance tracing (tune in prod via env)
  tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
  beforeSend(event) {
    try {
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url);
          u.search = "";
          event.request.url = u.toString();
        } catch {}
      }
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, string>;
        for (const k of Object.keys(headers)) {
          if (/authorization|api[-_]?key|token/i.test(k))
            headers[k] = "[Filtered]";
        }
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => {
          if (typeof b.message === "string") {
            b.message = b.message.replace(
              /(apikey|token|authorization)=([^\s&]+)/gi,
              "$1=[Filtered]",
            );
          }
          return b;
        });
      }
    } catch {}
    return event;
  },
});

// (Removed) dev-only renderer error trigger for Sentry

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
