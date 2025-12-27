import { describe, it, expect } from "vitest";
import { parseClientMessage } from "./messages";

describe("types/messages.parseClientMessage", () => {
  it("parses start with optional fields", () => {
    const msg = parseClientMessage({
      type: "start",
      version: 2,
      format: "pcm16le",
      rate: 16000,
      traceId: "t1",
      language: "en",
    });
    expect(msg).toEqual({
      type: "start",
      version: 2,
      format: "pcm16le",
      rate: 16000,
      traceId: "t1",
      language: "en",
    });
  });

  it("drops unexpected field types", () => {
    // rate is wrong type -> undefined; format invalid -> undefined
    const msg = parseClientMessage({
      type: "start",
      version: 2,
      format: "flac",
      rate: "bad",
      traceId: 123,
    });
    expect(msg).toEqual({
      type: "start",
      version: 2,
      format: undefined,
      rate: undefined,
      traceId: undefined,
      language: undefined,
    });
  });

  it("parses end and cancel", () => {
    expect(parseClientMessage({ type: "end" })).toEqual({ type: "end" });
    expect(parseClientMessage({ type: "cancel" })).toEqual({ type: "cancel" });
  });

  it("returns null for invalid shapes", () => {
    expect(parseClientMessage({})).toBeNull();
    expect(parseClientMessage({ type: "noop" })).toBeNull();
    expect(parseClientMessage(null as any)).toBeNull();
  });

  it("parses selection payload with source metadata", () => {
    const msg = parseClientMessage({
      type: "start",
      selection: {
        text: "hello",
        hadSelection: true,
        source: "clipboard",
        status: "read:ok",
        range: { location: 1, length: 5 },
        valueLength: 10,
      },
    });

    expect(msg).toEqual({
      type: "start",
      version: undefined,
      format: undefined,
      rate: undefined,
      traceId: undefined,
      language: undefined,
      mode: undefined,
      selection: {
        status: "read:ok",
        hadSelection: true,
        text: "hello",
        range: { location: 1, length: 5 },
        valueLength: 10,
        source: "clipboard",
      },
    });
  });

  it("drops invalid selection source values", () => {
    const msg = parseClientMessage({
      type: "start",
      selection: {
        text: "hi",
        source: "bogus",
      },
    });

    expect(msg?.type).toBe("start");
    if (msg?.type === "start") {
      expect(msg.selection?.source).toBeUndefined();
    }
  });

  it("parses identity payload when provided", () => {
    const msg = parseClientMessage({
      type: "start",
      identity: {
        name: "Alex",
        email: "alex@example.com",
        extra: "ignore",
      },
    } as Record<string, unknown>);

    expect(msg?.type).toBe("start");
    if (msg?.type === "start") {
      expect(msg.identity).toEqual({ name: "Alex", email: "alex@example.com" });
    }
  });

  it("parses auth message with token", () => {
    const msg = parseClientMessage({ type: "auth", token: "test-jwt-token" });
    expect(msg).toEqual({
      type: "auth",
      token: "test-jwt-token",
      traceId: undefined,
    });
  });

  it("parses auth message with empty token", () => {
    const msg = parseClientMessage({ type: "auth" });
    expect(msg).toEqual({ type: "auth", token: "", traceId: undefined });
  });

  it("parses auth message with traceId", () => {
    const msg = parseClientMessage({
      type: "auth",
      token: "t",
      traceId: "trace-1",
    });
    expect(msg).toEqual({ type: "auth", token: "t", traceId: "trace-1" });
  });
});
