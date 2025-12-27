export function safeClose(ws: WebSocket, code = 1000, reason = "OK") {
  try {
    ws.close(code, reason);
  } catch {
    // ignore
  }
}

export function safeJson<T = any>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
