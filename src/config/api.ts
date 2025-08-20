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

