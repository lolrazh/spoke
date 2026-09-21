import { describe, expect, it } from "vitest";
import { createCapturedAudio } from "./capturedAudio";
import type { TranscriptionProvider } from "./providerContracts";
import { TranscriptionSessionError } from "./sessionErrors";
import { createSessionOrchestrator } from "./sessionOrchestrator";

const testAudio = createCapturedAudio(new Int16Array([1, 2, 3, 4]));

const localProvider: TranscriptionProvider = {
  descriptor: {
    id: "local",
    displayName: "Local",
    kind: "local",
  },
  transcribe: async () => ({ text: "local transcript" }),
};

const secondaryProvider: TranscriptionProvider = {
  descriptor: {
    id: "secondary",
    displayName: "Secondary",
    kind: "local",
  },
  prepare: async () => ({}),
  transcribe: async () => ({ text: "secondary transcript" }),
};

describe("createSessionOrchestrator", () => {
  it("uses the configured default provider", async () => {
    const orchestrator = createSessionOrchestrator({
      providers: [localProvider, secondaryProvider],
      defaultProviderId: "secondary",
    });

    const result = await orchestrator.transcribe(undefined, {
      audio: testAudio,
      context: { mode: "dictation" },
    });

    expect(orchestrator.defaultProviderId).toBe("secondary");
    expect(result.text).toBe("secondary transcript");
  });

  it("returns null when a provider has no prepare phase", async () => {
    const orchestrator = createSessionOrchestrator({
      providers: [localProvider],
    });

    const result = await orchestrator.prepare(undefined, {
      context: { mode: "dictation" },
    });

    expect(result).toBeNull();
  });

  it("throws a typed error when a provider id is unknown", () => {
    const orchestrator = createSessionOrchestrator({
      providers: [localProvider],
    });

    expect(() => orchestrator.resolveProvider("missing")).toThrow(
      TranscriptionSessionError,
    );
  });

  it("throws a typed error when no providers are registered", () => {
    expect(() =>
      createSessionOrchestrator({
        providers: [],
      }),
    ).toThrow(TranscriptionSessionError);
  });
});
