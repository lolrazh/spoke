import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTranscribeUrl, getTranscribeWsUrl } from "./api";

const setLocation = (href: string) => {
  const u = new URL(href);
  // Hard-stub window.location hostname/search for deterministic behavior
  Object.defineProperty(window, "location", {
    value: {
      hostname: u.hostname,
      search: u.search,
    },
    configurable: true,
  });
};

describe("config/api", () => {
  let originalEnv: any;

  beforeEach(() => {
    // Reset URL and localStorage between tests
    setLocation("https://app.sonicflow.app/");
    window.localStorage.clear();
    // Stub out Vite dev flag so heuristics don't force local
    // @ts-ignore
    originalEnv = (import.meta as any).env;
    // @ts-ignore
    (import.meta as any).env = {};
  });

  afterEach(() => {
    // @ts-ignore
    (import.meta as any).env = originalEnv;
  });

  it("returns local endpoints in dev mode (Vitest env)", () => {
    setLocation("https://app.sonicflow.app/");
    // Vitest sets import.meta.env.DEV, so functions should prefer local
    expect(getTranscribeUrl()).toBe("http://127.0.0.1:8787/transcribe");
    expect(getTranscribeWsUrl()).toBe("ws://127.0.0.1:8787/ws");
  });

  it("prefers local endpoints when running on localhost", () => {
    setLocation("http://127.0.0.1:3000/");
    expect(getTranscribeUrl()).toBe("http://127.0.0.1:8787/transcribe");
    expect(getTranscribeWsUrl()).toBe("ws://127.0.0.1:8787/ws");
  });

  it("forces local WS via query param or localStorage flag", () => {
    setLocation("https://app.sonicflow.app/?localWs=1");
    expect(getTranscribeWsUrl()).toBe("ws://127.0.0.1:8787/ws");

    setLocation("https://app.sonicflow.app/");
    window.localStorage.setItem("sf.localWs", "1");
    expect(getTranscribeWsUrl()).toBe("ws://127.0.0.1:8787/ws");
  });

  it("accepts explicit ws override via query param and normalizes scheme/path", () => {
    setLocation("https://app.sonicflow.app/?ws=example.com");
    expect(window.location.search).toBe("?ws=example.com");
    // No path provided, so it normalizes to wss://example.com/ws
    expect(getTranscribeWsUrl()).toBe("wss://example.com/ws");

    setLocation("https://app.sonicflow.app/?ws=http://foo.bar/custom");
    expect(window.location.search).toBe("?ws=http://foo.bar/custom");
    // http -> ws, preserves custom path
    expect(getTranscribeWsUrl()).toBe("ws://foo.bar/custom");
  });
});
