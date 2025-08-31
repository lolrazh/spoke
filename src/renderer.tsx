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
              /(supabase|apikey|token|authorization)=([^\s&]+)/gi,
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

const existing = document.getElementById("root");
if (existing) {
  mountReact(existing);
} else {
  const created = document.createElement("div");
  created.id = "root";
  document.body.appendChild(created);
  mountReact(created);
}

// Signal main when UI is visually ready to reveal (styles and fonts applied)
void (async () => {
  try {
    const fonts = (document as unknown as {
      fonts?: { ready?: Promise<void> };
    }).fonts;
    if (fonts?.ready) {
      await fonts.ready;
    }
  } catch {}
  // Next frame to ensure first paint with styles is committed
  requestAnimationFrame(() => {
    try {
      window.electron?.rendererReady?.();
    } catch {}
  });
})();

console.log("🎤 Sonic Flow is running");
