import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { useTranscription } from "./useTranscription";
import { FakeWebSocket } from "../test/fakes/fakeWebSocket";
import { FakeAudioContext, FakeAudioWorkletNode } from "../test/fakes/fakeAudio";

vi.mock("../config/api", () => ({ getTranscribeWsUrl: () => "ws://test/ws" }));
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
    // Deterministic mediaDevices
    // @ts-ignore
    navigator.mediaDevices = navigator.mediaDevices || {};
    // @ts-ignore
    navigator.mediaDevices.getUserMedia = async () =>
      ({ getTracks: () => [{ stop: () => {} }] }) as unknown as MediaStream;
    // Intercept metrics POST
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as any;
  });

  afterEach(() => {
    (globalThis as any).AudioContext = orig.AC;
    (globalThis as any).AudioWorkletNode = orig.AWN;
    (globalThis as any).WebSocket = orig.WS;
    globalThis.fetch = orig.fetch as any;
    FakeWebSocket.instances.length = 0;
  });

  it("streams start->stop with flush + end and posts metrics", async () => {
    const r = renderUseTranscription({ autoEnumerateDevices: false, autoInitStream: false });
    // Start recording
    await act(async () => { await r.hook.start(); });
    // Allow WS to open
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });

    expect(FakeWebSocket.instances.length).toBe(1);
    const ws = FakeWebSocket.instances[0];

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
    ws.emitMessage(JSON.stringify({ type: "final", text: "hello world" }));
    await act(async () => { await stopP; });

    // Verify final text applied and clipboard updated
    expect(r.hook.text).toBe("hello world");

    // Verify 'end' was sent exactly once
    const endMsgs = ws.sent
      .filter((m) => typeof m === "string")
      .map((s) => JSON.parse(String(s)))
      .filter((j) => j.type === "end");
    expect(endMsgs.length).toBe(1);

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

    r.unmount();
  });

  it("cancel sends 'cancel' and does not send 'end'", async () => {
    const r = renderUseTranscription({ autoEnumerateDevices: false, autoInitStream: false });
    await act(async () => { await r.hook.start(); });
    await act(async () => { await Promise.resolve(); });
    const ws = FakeWebSocket.instances[0];
    await act(async () => { await r.hook.cancel(); });

    const sent = ws.sent
      .filter((m) => typeof m === "string")
      .map((s) => JSON.parse(String(s)));
    expect(sent.some((j) => j.type === "cancel")).toBe(true);
    expect(sent.some((j) => j.type === "end")).toBe(false);

    r.unmount();
  });
});
