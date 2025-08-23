import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { useTranscription } from "./useTranscription";

// Mock modules the hook imports
vi.mock("../config/api", () => ({ getTranscribeWsUrl: () => "ws://test/ws" }));
vi.mock("../utils/audioFeedback", () => ({
  playToggleOn: vi.fn(),
  playToggleOff: vi.fn(),
}));

// Minimal fakes for audio APIs used by the hook
class FakeAudioContext {
  sampleRate = 48000;
  audioWorklet = { addModule: async (_: string) => {} };
  createMediaStreamSource(_stream: MediaStream) {
    return { connect: () => {}, disconnect: () => {} } as any;
  }
  async close() {}
}

class FakeAudioWorkletNode {
  port: {
    onmessage: ((ev: MessageEvent) => void) | null;
    postMessage: (msg: any) => void;
  };
  constructor(_ctx: any, _name: string, _opts: any) {
    this.port = {
      onmessage: null,
      postMessage: (_msg: any) => {},
    };
    // expose for tests
    (globalThis as any).__lastWorklet = this;
  }
  connect() {}
  disconnect() {}
}

// Minimal WebSocket fake
class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  onopen: ((ev?: any) => void) | null = null;
  onerror: ((ev?: any) => void) | null = null;
  onclose: ((ev?: any) => void) | null = null;
  binaryType = "arraybuffer";
  bufferedAmount = 0;
  sent: any[] = [];
  private listeners: Record<string, Function[]> = {
    message: [],
    error: [],
    close: [],
  };
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
    // Open on next macrotask to allow assignment of onopen
    setTimeout(() => {
      this.onopen && this.onopen({});
    }, 0);
  }
  send(data: any) {
    this.sent.push(data);
  }
  addEventListener(type: "message" | "error" | "close", cb: Function) {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener(type: "message" | "error" | "close", cb: Function) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== cb);
  }
  close(code?: number, reason?: string) {
    this.onclose && this.onclose({ code, reason });
    (this.listeners.close || []).forEach((fn) => fn({ code, reason }));
  }
  emitMessage(data: any) {
    (this.listeners.message || []).forEach((fn) => fn({ data }));
  }
}

// Helper to render the hook
function renderUseTranscription(opts?: any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const out: { current: ReturnType<typeof useTranscription> | null } = {
    current: null,
  };
  function Test() {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const hook = useTranscription(opts);
    out.current = hook;
    return null;
  }
  act(() => {
    root.render(React.createElement(Test));
  });
  return {
    get hook() {
      return out.current!;
    },
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("hooks/useTranscription", () => {
  const orig = {
    AC: (globalThis as any).AudioContext,
    AWN: (globalThis as any).AudioWorkletNode,
    WS: (globalThis as any).WebSocket,
  };
  let insertTextSpy: any;
  let transcriptSpy: any;

  beforeEach(() => {
    // Globals
    (globalThis as any).AudioContext = FakeAudioContext;
    (globalThis as any).AudioWorkletNode = FakeAudioWorkletNode;
    (globalThis as any).WebSocket = FakeWS as any;
    // MediaDevices stub
    // @ts-ignore
    navigator.mediaDevices = navigator.mediaDevices || {};
    // @ts-ignore
    navigator.mediaDevices.getUserMedia = async () =>
      ({ getTracks: () => [{ stop: () => {} }] }) as any;
    // Spies for side-effects
    insertTextSpy = vi.fn(async () => ({ success: true }));
    transcriptSpy = vi.fn();
    (window as any).clipboard = { insertText: insertTextSpy };
    (window as any).transcript = { update: transcriptSpy };
  });

  afterEach(() => {
    (globalThis as any).AudioContext = orig.AC;
    (globalThis as any).AudioWorkletNode = orig.AWN;
    (globalThis as any).WebSocket = orig.WS;
    FakeWS.instances.length = 0;
  });

  it("starts recording, opens WS, and exchanges control messages", async () => {
    const r = renderUseTranscription({
      autoEnumerateDevices: false,
      autoInitStream: false,
    });
    // Start
    await act(async () => {
      await r.hook.start();
    });
    // Ensure pending onopen (macrotask) and microtasks are flushed
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should have created a WS and sent at least one start message
    expect(FakeWS.instances.length).toBe(1);
    const ws = FakeWS.instances[0];
    const startMsgs = ws.sent
      .filter((m) => typeof m === "string")
      .map((s) => JSON.parse(String(s)))
      .filter((j) => j.type === "start");
    expect(startMsgs.length).toBeGreaterThan(0);

    // Stop: should send 'end' and resolve after server final
    const p = r.hook.stop();
    // Ensure stop has time to attach listeners
    await new Promise((r) => setTimeout(r, 0));
    ws.emitMessage(JSON.stringify({ type: "status", state: "processing" }));
    ws.emitMessage(JSON.stringify({ type: "final", text: "hello world" }));
    await act(async () => {
      await p;
      await new Promise((r) => setTimeout(r, 0));
    });

    // Verify final text applied and clipboard updated
    expect(r.hook.text).toBe("hello world");
    expect(insertTextSpy).toHaveBeenCalledWith("hello world");

    // Verify an 'end' control message was sent
    const endMsgs = ws.sent
      .filter((m) => typeof m === "string")
      .map((s) => JSON.parse(String(s)))
      .filter((j) => j.type === "end");
    expect(endMsgs.length).toBe(1);

    r.unmount();
  });

  it("cancel sends cancel without waiting for final", async () => {
    const r2 = renderUseTranscription({
      autoEnumerateDevices: false,
      autoInitStream: false,
    });
    await act(async () => {
      await r2.hook.start();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const ws = FakeWS.instances[0];
    await act(async () => {
      await r2.hook.cancel();
    });
    // After cancel, there should be no 'end' message and recording stops
    const endMsgs = ws.sent
      .filter((m) => typeof m === "string")
      .map((s) => JSON.parse(String(s)))
      .filter((j) => j.type === "end");
    expect(endMsgs.length).toBe(0);
    expect(r2.hook.recording).toBe(false);
    r2.unmount();
  });
});
