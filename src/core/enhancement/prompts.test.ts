import { describe, it, expect } from "vitest";
import { composeDynamicPrompt } from "./prompts";
import { detectTriggers } from "./triggers";

describe("services/llm/prompts", () => {
  describe("composeDynamicPrompt", () => {
    it("includes only base prompt for clean dictation", () => {
      const triggerContext = detectTriggers(
        "This is a normal sentence with no special instructions",
      );
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain("You are a verbatim ASR cleaner");
      expect(prompt).toContain("<rules>");
      expect(prompt).not.toContain("spell something a certain way");
      expect(prompt).not.toContain("symbol by name");
      expect(prompt).not.toContain("corrects themselves");
      expect(prompt).not.toContain("<examples>");
    });

    it("includes spelling module when spelling trigger fires", () => {
      const triggerContext = detectTriggers("Please spell that as S-P-O-K-E");
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain("You are a verbatim ASR cleaner");
      expect(prompt).toContain("spell something a certain way");
      expect(prompt).toContain("<examples>");
      expect(prompt).toContain("Celero VAD");
      expect(prompt).not.toContain("symbol by name");
    });

    it("includes symbols module when symbol trigger fires", () => {
      const triggerContext = detectTriggers("Add an at symbol before worker");
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain("symbol by name");
      expect(prompt).toContain("<examples>");
      expect(prompt).toContain("@mom");
      expect(prompt).not.toContain("spell something a certain way");
    });

    it("includes casing module when casing trigger fires", () => {
      const triggerContext = detectTriggers("Make this uppercase please");
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain("casing instructions");
      expect(prompt).toContain("<examples>");
      expect(prompt).not.toContain("symbol by name");
    });

    it("includes quotes module when quote trigger fires", () => {
      const triggerContext = detectTriggers("Put the word in quotes");
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain("quote-unquote");
      expect(prompt).toContain("<examples>");
      expect(prompt).toContain('"lucky"');
    });

    it("includes disfluency module when disfluency trigger fires", () => {
      const triggerContext = detectTriggers("Turn left sorry turn right");
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain("corrects themselves");
      expect(prompt).toContain("<examples>");
      expect(prompt).toContain("option key");
    });

    it("includes lists module when list trigger fires", () => {
      const triggerContext = detectTriggers(
        "Tasks: 1 buy milk, 2 walk dog, 3 finish report",
      );
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain("Auto-format as a list");
      // No examples for lists per user request
    });

    it("includes multiple modules when multiple triggers fire", () => {
      const triggerContext = detectTriggers(
        "Make it uppercase and add an at symbol, also spell C L A U D E",
      );
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).toContain("casing instructions");
      expect(prompt).toContain("symbol by name");
      expect(prompt).toContain("spell something a certain way");
      expect(prompt).toContain("<examples>");
      expect(prompt).toContain("@mom");
      expect(prompt).toContain("CLAUDE.md");
    });

    it("includes vocabulary when provided", () => {
      const triggerContext = detectTriggers("Normal text");
      const prompt = composeDynamicPrompt(triggerContext, {
        vocabulary: "Spoke, Claude, Supabase",
      });

      expect(prompt).toContain("<vocabulary>");
      expect(prompt).toContain("Spoke, Claude, Supabase");
    });

    it("omits vocabulary section when not provided", () => {
      const triggerContext = detectTriggers("Normal text");
      const prompt = composeDynamicPrompt(triggerContext);

      expect(prompt).not.toContain("<vocabulary>");
    });
  });
});
