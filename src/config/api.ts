// Centralized API endpoint selection for dev/prod

/**
 * Get base API URL for HTTP transcription
 */
function getBaseApiUrl(): string {
  try {
    const env =
      (import.meta as unknown as { env?: Record<string, unknown> }).env || {};
    const override = env?.VITE_TRANSCRIBE_URL as string | undefined;
    if (override && override.trim()) {
      // Strip /transcribe suffix if present
      const url = override.trim();
      return url.replace(/\/transcribe$/, "");
    }

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
      return "http://127.0.0.1:8787";
    }

    return "https://api.spoke.so";
  } catch {
    return "https://api.spoke.so";
  }
}

/**
 * Get /prepare endpoint (pre-flight auth + OCR)
 */
export function getPrepareUrl(): string {
  return `${getBaseApiUrl()}/prepare`;
}

/**
 * Get /transcribe endpoint (main transcription)
 */
export function getTranscribeUrl(): string {
  return `${getBaseApiUrl()}/transcribe`;
}
