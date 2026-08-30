import { describe, it, expect } from "vitest";
import { selectSmartRoute, selectEditRoute } from "./smartRouting";
import { detectTriggers } from "./triggers";
import type { EnhancementConfig } from "./types";

const baseConfig: EnhancementConfig = {
  routerEnabled: true,
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  temperature: 0.2,
  timeoutMs: 25_000,
  advancedProvider: "groq",
  advancedModel: "kimi-k2-instruct",
  advancedTemperature: 0.3,
  advancedTimeoutMs: 30_000,
  editProvider: "groq",
  editModel: "kimi-k2-instruct",
  editTemperature: 0.6,
  editTimeoutMs: 30_000,
};

describe("enhancement/smartRouting", () => {
  describe("selectSmartRoute - bypass tier", () => {
    it("bypasses LLM for clean dictation with no triggers", () => {
      const text = "This is a normal sentence with no special instructions";
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseConfig);

      expect(decision.tier).toBe("bypass");
      expect(decision.provider).toBeUndefined();
      expect(decision.model).toBeUndefined();
      expect(decision.triggeredRules).toEqual([]);
      expect(decision.reason).toBe("no_triggers_detected");
    });

    it("bypasses for multiple clean sentences", () => {
      const text =
        "The quick brown fox jumps over the lazy dog. This is a test.";
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseConfig);

      expect(decision.tier).toBe("bypass");
    });
  });

  describe("selectSmartRoute - default tier", () => {
    it("routes to advanced model for spelling triggers (always)", () => {
      const text = "Please spell that as S-P-O-K-E";
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseConfig);

      expect(decision.tier).toBe("advanced");
      expect(decision.provider).toBe("groq");
      expect(decision.model).toBe("kimi-k2-instruct");
      expect(decision.temperature).toBe(0.3);
      expect(decision.triggeredRules).toContain("spelling");
      expect(decision.reason).toBe("spelling_trigger");
    });

    it("routes to default model for symbol triggers", () => {
      const text = "Add an at symbol before worker";
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseConfig);

      expect(decision.tier).toBe("default");
      expect(decision.triggeredRules).toContain("symbols");
    });

    it("routes to default model for casing triggers", () => {
      const text = "Make this uppercase please";
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseConfig);

      expect(decision.tier).toBe("default");
      expect(decision.triggeredRules).toContain("casing");
    });

    it("routes to default model for disfluency triggers", () => {
      const text = "Turn left sorry turn right";
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseConfig);

      expect(decision.tier).toBe("default");
      expect(decision.triggeredRules).toContain("disfluency");
    });

    it("routes to default for list triggers", () => {
      const text = "Tasks: 1 buy milk, 2 walk dog, 3 finish report";
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, baseConfig);

      expect(decision.tier).toBe("default");
      expect(decision.triggeredRules).toContain("list");
    });
  });

  describe("selectSmartRoute - advanced tier", () => {
    it("routes long text WITH triggers to advanced model", () => {
      const longText = "Please make this uppercase. " + "a".repeat(1300);
      const triggerContext = detectTriggers(longText);
      const decision = selectSmartRoute(longText, triggerContext, baseConfig);

      expect(decision.tier).toBe("advanced");
      expect(decision.model).toBe("kimi-k2-instruct");
      expect(decision.reason).toContain("long_with_triggers");
    });

    it("bypasses LLM for long text WITHOUT triggers", () => {
      const longCleanText = Array.from(
        { length: 200 },
        (_, i) => `sentence${i}`,
      ).join(" ");
      const triggerContext = detectTriggers(longCleanText);
      const decision = selectSmartRoute(
        longCleanText,
        triggerContext,
        baseConfig,
      );

      expect(decision.tier).toBe("bypass");
    });
  });

  describe("selectSmartRoute - router disabled", () => {
    it("always uses default model when router is disabled", () => {
      const disabledConfig = { ...baseConfig, routerEnabled: false };
      const text = "Normal text with no triggers";
      const triggerContext = detectTriggers(text);
      const decision = selectSmartRoute(text, triggerContext, disabledConfig);

      expect(decision.tier).toBe("default");
      expect(decision.reason).toBe("router_disabled");
    });
  });

  describe("selectEditRoute", () => {
    it("always returns edit tier", () => {
      const decision = selectEditRoute(baseConfig);

      expect(decision.tier).toBe("edit");
      expect(decision.provider).toBe("groq");
      expect(decision.model).toBe("kimi-k2-instruct");
      expect(decision.temperature).toBe(0.6);
      expect(decision.reason).toBe("edit_mode");
    });
  });
});
