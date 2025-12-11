// Centralized API endpoint selection for dev/prod

// In the renderer (Vite), prefer VITE_* env. Fallback to sensible defaults.
export function getTranscribeUrl(): string {
  try {
    const env = ((import.meta as unknown) as { env?: Record<string, unknown> })
      .env || {};
    const override = env?.VITE_TRANSCRIBE_URL as string | undefined;
    if (override && override.trim()) return override.trim();

    const isViteDev = Boolean(env?.DEV);
    const isHttpLocal =
      typeof window !== "undefined" &&
      (window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost");
    const forceLocal =
      typeof window !== "undefined" &&
      (new URLSearchParams(window.location.search).has("localWs") ||
        (typeof window.localStorage !== "undefined" &&
          window.localStorage.getItem("sf.localWs") === "1"));

    if (isViteDev || isHttpLocal || forceLocal) {
      return "http://127.0.0.1:8787/transcribe";
    }

    return "https://api.spoke.so/transcribe";
  } catch {
    return "https://api.spoke.so/transcribe";
  }
}

// WebSocket endpoint for real-time transcription
export function getTranscribeWsUrl(): string {
  try {
    const env = ((import.meta as unknown) as { env?: Record<string, unknown> })
      .env || {};
    // Highest priority: explicit URL from query param (?ws=...)
    try {
      if (typeof window !== "undefined") {
        const qs = new URLSearchParams(window.location.search);
        const qp = qs.get("ws");
        if (qp && qp.trim()) return normalize(qp.trim());
      }
    } catch { }
    const override = env?.VITE_TRANSCRIBE_WS_URL as string | undefined;
    if (override && override.trim()) return normalize(override.trim());

    const isViteDev = Boolean(env?.DEV);
    const isHttpLocal =
      typeof window !== "undefined" &&
      (window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "localhost");
    const forceLocal =
      typeof window !== "undefined" &&
      (new URLSearchParams(window.location.search).has("localWs") ||
        (typeof window.localStorage !== "undefined" &&
          window.localStorage.getItem("sf.localWs") === "1"));

    if (isViteDev || isHttpLocal || forceLocal) {
      return "ws://127.0.0.1:8787/ws";
    }

    return "wss://api.spoke.so/ws";
  } catch {
    return "wss://api.spoke.so/ws";
  }
}



function normalize(input: string): string {
  try {
    const hasScheme = /^([a-z]+):\/\//i.test(input);
    const u = new URL(hasScheme ? input : `https://${input}`);
    if (u.protocol === "http:") u.protocol = "ws:";
    if (u.protocol === "https:") u.protocol = "wss:";
    if (!u.pathname || u.pathname === "/") u.pathname = "/ws";
    return u.toString();
  } catch {
    return input;
  }
}
