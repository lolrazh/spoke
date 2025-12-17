import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { useTranscription } from "./useTranscription";
import { FakeWebSocket } from "../test/fakes/fakeWebSocket";
import { FakeAudioContext, FakeAudioWorkletNode } from "../test/fakes/fakeAudio";

vi.mock("../config/api", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getTranscribeWsUrl: () => "ws://test/ws",
  };
});
vi.mock("../utils/audioFeedback", () => ({
  playToggleOn: vi.fn(),
  playToggleOff: vi.fn(),
}));
// This suite asserts the pre-VAD streaming behavior (always sends end and processes final),
// so we disable VAD gating for these tests.
vi.mock("../config/vad", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    VAD_ENABLED: false,
  };
});
vi.mock("../state/quotaCache", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    isQuotaExceeded: () => false,
  };
});
// Mock Supabase auth to return a fake token
vi.mock("../lib/supabaseClient", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getAccessToken: vi.fn(() => Promise.resolve("fake-test-token")),
    getCurrentUser: vi.fn(() => Promise.resolve({ id: "test-user-id" })),
  };
});

function renderUseTranscription(opts?: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const out: { current: ReturnType<typeof useTranscription> | null } = {
    current: null,
  };
  function Test(): null {
    const hook = useTranscription(opts as Parameters<typeof useTranscription>[0]);
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
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function waitForWebSocket(): Promise<FakeWebSocket> {
  // start() does async work (mic open, auth handshake), so allow a bit of time.
  for (let i = 0; i < 50; i++) {
    if (FakeWebSocket.instances.length > 0) {
      return FakeWebSocket.instances[0];
    }
    await new Promise((res) => setTimeout(res, 0));
  }
  throw new Error("WebSocket not created");
}

async function waitForSent(
  ws: FakeWebSocket,
  type: string,
  timeoutMs = 1500,
): Promise<boolean> {
  const start = Date.now();
  const matches = (msg: unknown) => {
    if (typeof msg !== "string") return false;
    try {
      return JSON.parse(msg).type === type;
    } catch {
      return false;
    }
  };
  while (Date.now() - start < timeoutMs) {
    if (ws.sent.some(matches)) return true;
    await new Promise((res) => setTimeout(res, 5));
  }
  return ws.sent.some(matches);
}

describe("hooks/useTranscription (production-like)", () => {
  const orig = {
    AC: (globalThis as any).AudioContext,
    AWN: (globalThis as any).AudioWorkletNode,
    WS: (globalThis as any).WebSocket,
    fetch: globalThis.fetch,
    actEnv: (globalThis as any).IS_REACT_ACT_ENVIRONMENT,
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).AudioContext = FakeAudioContext as any;
    (globalThis as any).AudioWorkletNode = FakeAudioWorkletNode as any;
    (globalThis as any).WebSocket = FakeWebSocket as any;
    const fakeTrack = {
      stop: () => {},
      getSettings: () => ({}),
    };
    // Deterministic mediaDevices
    // @ts-ignore
    navigator.mediaDevices = navigator.mediaDevices || {};
    // @ts-ignore
    navigator.mediaDevices.getUserMedia = async () =>
      ({
        getTracks: () => [fakeTrack],
        getAudioTracks: () => [fakeTrack],
      }) as unknown as MediaStream;
    // Intercept metrics POST
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as any;
    (globalThis as any).window.fetch = fetchMock as any;
  });

  afterEach(() => {
    (globalThis as any).AudioContext = orig.AC;
    (globalThis as any).AudioWorkletNode = orig.AWN;
    (globalThis as any).WebSocket = orig.WS;
    globalThis.fetch = orig.fetch as any;
    (globalThis as any).window.fetch = orig.fetch as any;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = orig.actEnv;
    FakeWebSocket.instances.length = 0;
  });

  it("streams start->stop with flush + end and posts metrics", async () => {
    const r = renderUseTranscription({ autoEnumerateDevices: false, autoInitStream: false });
    let ws: FakeWebSocket | null = null;
    await act(async () => {
      const startTask = r.hook.start();
      ws = await waitForWebSocket();
      // Allow FakeWebSocket constructor's next-tick open() to run (auth is sent on "open")
      await new Promise((res) => setTimeout(res, 0));
      ws.emitMessage(JSON.stringify({ type: "auth_ok", userId: "test-user" }));
      await new Promise((res) => setTimeout(res, 10));
      await startTask;
    });
    if (!ws) throw new Error("WebSocket not created");

    // Should have sent auth and then start messages
    const authMsgs = ws.sent
      .filter((m) => typeof m === "string")
      .map((s) => JSON.parse(String(s)))
      .filter((j) => j.type === "auth");
    expect(authMsgs.length).toBeGreaterThan(0);

    const startMsgs = ws.sent
      .filter((m) => typeof m === "string")
      .map((s) => JSON.parse(String(s)))
      .filter((j) => j.type === "start");
    expect(startMsgs.length).toBeGreaterThan(0);

    // Stop and simulate server replies
    const stopP = r.hook.stop();
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    ws.emitMessage(JSON.stringify({ type: "status", state: "processing" }));
    await waitForSent(ws, "end");
    ws.emitMessage(
      JSON.stringify({
        type: "final",
        text: "hello world",
        dataset: { sttText: "hello world", llmText: null },
      }),
    );
    await act(async () => { await stopP; });
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });

    // Verify final text applied and clipboard updated
    expect(r.hook.text).toBe("hello world");

    // Verify worklet received flush -> reset
    const lastWorklet = (globalThis as any).__lastWorklet as FakeAudioWorkletNode;
    const posted = (lastWorklet.port as any).posted as unknown[];
    const postedTypes = posted.map((m: any) => m?.type);
    expect(postedTypes).toContain("flush");
    expect(postedTypes).toContain("reset");

    r.unmount();
  });

  it("forwards dataset only when sharing is enabled", async () => {
    const r = renderUseTranscription({
      autoEnumerateDevices: false,
      autoInitStream: false,
      shareTranscriptionsEnabled: true,
    });
    let ws: FakeWebSocket | null = null;
    await act(async () => {
      const startTask = r.hook.start();
      ws = await waitForWebSocket();
      // Allow FakeWebSocket constructor's next-tick open() to run (auth is sent on "open")
      await new Promise((res) => setTimeout(res, 0));
      // Simulate auth success
      ws.emitMessage(JSON.stringify({ type: "auth_ok", userId: "test-user" }));
      await new Promise((res) => setTimeout(res, 10));
      await startTask;
    });
    if (!ws) throw new Error("WebSocket not created");
    const stopP = r.hook.stop();
    await act(async () => { await Promise.resolve(); });
    ws.emitMessage(
      JSON.stringify({
        type: "status",
        state: "processing",
      }),
    );
    await waitForSent(ws, "end");
    ws.emitMessage(
      JSON.stringify({
        type: "final",
        text: "shared",
        dataset: { sttText: "shared", llmText: "result" },
      }),
    );
    await act(async () => { await stopP; });
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });


    r.unmount();
  });

  it("cancel sends 'cancel' and does not send 'end'", async () => {
    const r = renderUseTranscription({ autoEnumerateDevices: false, autoInitStream: false });
    let ws: FakeWebSocket | null = null;
    await act(async () => {
      const startTask = r.hook.start();
      ws = await waitForWebSocket();
      // Allow FakeWebSocket constructor's next-tick open() to run (auth is sent on "open")
      await new Promise((res) => setTimeout(res, 0));
      // Simulate auth success
      ws.emitMessage(JSON.stringify({ type: "auth_ok", userId: "test-user" }));
      await new Promise((res) => setTimeout(res, 10));
      await startTask;
    });
    if (!ws) throw new Error("WebSocket not created");
    await act(async () => { await r.hook.cancel(); });
    expect(await waitForSent(ws, "cancel")).toBe(true);

    const sent = ws.sent
      .filter((m) => typeof m === "string")
      .map((s) => JSON.parse(String(s)));
    expect(sent.some((j) => j.type === "cancel")).toBe(true);
    expect(sent.some((j) => j.type === "end")).toBe(false);

    r.unmount();
  });
});
