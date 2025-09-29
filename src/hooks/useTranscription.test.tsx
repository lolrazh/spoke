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
    ...actual,
    getTranscribeWsUrl: () => "ws://test/ws",
  };
});
vi.mock("../utils/audioFeedback", () => ({
  playToggleOn: vi.fn(),
  playToggleOff: vi.fn(),
}));

function renderUseTranscription(opts?: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const out: { current: ReturnType<typeof useTranscription> | null } = {
    current: null,
  };
  function Test() {
    const hook = useTranscription(opts as any);
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
  for (let i = 0; i < 5; i++) {
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
  };

  beforeEach(() => {
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
    FakeWebSocket.instances.length = 0;
  });

  it("streams start->stop with flush + end and posts metrics", async () => {
    const r = renderUseTranscription({ autoEnumerateDevices: false, autoInitStream: false });
    // Start recording
    await act(async () => { await r.hook.start(); });
    // Allow WS to open
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    const ws = await waitForWebSocket();

    // Should have sent a start message
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

    // Metrics POST
    const calls = (globalThis.fetch as any).mock.calls;
    const post = calls.find((c: any[]) => typeof c?.[0] === "string" && c?.[0].includes("/metrics/session"));
    expect(post).toBeTruthy();
    const payload = JSON.parse(post[1].body);
    expect(payload.shareTranscriptions).toBe(false);
    expect(payload.dataset).toBeNull();

    r.unmount();
  });

  it("forwards dataset only when sharing is enabled", async () => {
    const r = renderUseTranscription({
      autoEnumerateDevices: false,
      autoInitStream: false,
      shareTranscriptionsEnabled: true,
    });
    await act(async () => { await r.hook.start(); });
    await act(async () => { await Promise.resolve(); });
    const ws = await waitForWebSocket();
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

    const calls = (globalThis.fetch as any).mock.calls;
    const post = calls.find((c: any[]) => typeof c?.[0] === "string" && c?.[0].includes("/metrics/session"));
    expect(post).toBeTruthy();
    const payload = JSON.parse(post[1].body);
    expect(payload.shareTranscriptions).toBe(true);
    expect(payload.dataset).toEqual({ sttText: "shared", llmText: "result" });


    r.unmount();
  });

  it("cancel sends 'cancel' and does not send 'end'", async () => {
    const r = renderUseTranscription({ autoEnumerateDevices: false, autoInitStream: false });
    await act(async () => { await r.hook.start(); });
    await act(async () => { await Promise.resolve(); });
    const ws = await waitForWebSocket();
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
