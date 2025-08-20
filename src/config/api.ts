// Centralized API endpoint selection for dev/prod

// In the renderer (Vite), prefer VITE_* env. Fallback to sensible defaults.
export function getTranscribeUrl(): string {
  try {
    const mode = (import.meta as any)?.env?.MODE as string | undefined;
    const isDev = mode && mode !== "production";
    const override = (import.meta as any)?.env?.VITE_TRANSCRIBE_URL as string | undefined;

    if (override && typeof override === "string" && override.trim()) {
      return override.trim();
    }

    // Default dev endpoint assumes `wrangler dev` on localhost
    if (isDev) {
      return "http://127.0.0.1:8787/transcribe";
    }

    // Production default
    return "https://api.sonicflow.app/transcribe";
  } catch {
    return "https://api.sonicflow.app/transcribe";
  }
}

// WebSocket endpoint for real-time transcription
export function getTranscribeWsUrl(): string {
  try {
    const mode = (import.meta as any)?.env?.MODE as string | undefined;
    const isDev = (import.meta as any)?.env?.DEV as boolean | undefined;
    const override = (import.meta as any)?.env?.VITE_TRANSCRIBE_WS_URL as string | undefined;

    // Debug logging in dev
    if (isDev) {
      console.log("[API] Environment detection:", { mode, isDev, override });
    }

    if (override && typeof override === "string" && override.trim()) {
      return override.trim();
    }

    // Use Vite's built-in DEV flag which is more reliable than MODE
    if (isDev) {
      return "ws://127.0.0.1:8787/ws";
    }

    // Production default
    return "wss://api.sonicflow.app/ws";
  } catch {
    return "wss://api.sonicflow.app/ws";
  }
}

