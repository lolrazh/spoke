import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPrepareUrl, getTranscribeUrl } from "./api";

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
    setLocation("https://app.spoke.so/");
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
    setLocation("https://app.spoke.so/");
    // Vitest sets import.meta.env.DEV, so functions should prefer local
    expect(getPrepareUrl()).toBe("http://127.0.0.1:8787/prepare");
    expect(getTranscribeUrl()).toBe("http://127.0.0.1:8787/transcribe");
  });

  it("prefers local endpoints when running on localhost", () => {
    setLocation("http://127.0.0.1:3000/");
    expect(getPrepareUrl()).toBe("http://127.0.0.1:8787/prepare");
    expect(getTranscribeUrl()).toBe("http://127.0.0.1:8787/transcribe");
  });
});
