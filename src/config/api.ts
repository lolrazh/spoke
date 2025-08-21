// Centralized API endpoint selection for dev/prod

// In the renderer (Vite), prefer VITE_* env. Fallback to sensible defaults.
export function getTranscribeUrl(): string {
  try {
    const env: any = (import.meta as any)?.env || {};
    const override = env?.VITE_TRANSCRIBE_URL as string | undefined;
    if (override && override.trim()) return override.trim();

    const isViteDev = Boolean(env?.DEV);
    const isHttpLocal = typeof window !== "undefined" &&
      (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
    const forceLocal = typeof window !== "undefined" && (
      new URLSearchParams(window.location.search).has("localWs") ||
      (typeof window.localStorage !== "undefined" && window.localStorage.getItem("sf.localWs") === "1")
    );

    if (isViteDev || isHttpLocal || forceLocal) {
      return "http://127.0.0.1:8787/transcribe";
    }

    return "https://api.sonicflow.app/transcribe";
  } catch {
    return "https://api.sonicflow.app/transcribe";
  }
}

// WebSocket endpoint for real-time transcription
export function getTranscribeWsUrl(): string {
  try {
    const env: any = (import.meta as any)?.env || {};
    const override = env?.VITE_TRANSCRIBE_WS_URL as string | undefined;
    if (override && override.trim()) return override.trim();

    const isViteDev = Boolean(env?.DEV);
    const isHttpLocal = typeof window !== "undefined" &&
      (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
    const forceLocal = typeof window !== "undefined" && (
      new URLSearchParams(window.location.search).has("localWs") ||
      (typeof window.localStorage !== "undefined" && window.localStorage.getItem("sf.localWs") === "1")
    );

    if (isViteDev || isHttpLocal || forceLocal) {
      return "ws://127.0.0.1:8787/ws";
    }

    return "wss://api.sonicflow.app/ws";
  } catch {
    return "wss://api.sonicflow.app/ws";
  }
}
