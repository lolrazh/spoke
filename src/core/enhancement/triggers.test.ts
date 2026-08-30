import { describe, it, expect } from "vitest";
import { detectTriggers } from "./triggers";

describe("services/llm/triggers", () => {
  describe("detectTriggers - spelling", () => {
    it("detects spelled sequences with spaces", () => {
      const result = detectTriggers("Please write D N A sequence");
      expect(result.triggers.has("spelling")).toBe(true);
      expect(result.metadata.spelling?.sequences).toHaveLength(1);
      expect(result.metadata.spelling?.sequences[0].text).toMatch(/D N A/i);
      expect(result.requiresLLM).toBe(true);
    });

    it("detects spelled sequences with mixed case", () => {
      const result = detectTriggers("The name is S P O K E");
      expect(result.triggers.has("spelling")).toBe(true);
      expect(result.metadata.spelling?.sequences).toHaveLength(1);
    });

    it("detects spell instruction keywords", () => {
      const result = detectTriggers("Can you spell that for me?");
      expect(result.triggers.has("spelling")).toBe(true);
      expect(result.metadata.spelling?.instructions).toHaveLength(1);
      expect(result.metadata.spelling?.instructions[0].keyword).toBe("spell");
    });

    it('detects "spelled" and "spelling" variants', () => {
      const result1 = detectTriggers("I spelled it wrong");
      expect(result1.triggers.has("spelling")).toBe(true);
      expect(result1.metadata.spelling?.instructions[0].keyword).toBe(
        "spelled",
      );

      const result2 = detectTriggers("The spelling is incorrect");
      expect(result2.triggers.has("spelling")).toBe(true);
      expect(result2.metadata.spelling?.instructions[0].keyword).toBe(
        "spelling",
      );
    });

    it("does not trigger on normal text", () => {
      const result = detectTriggers(
        "This is a normal sentence with no special instructions",
      );
      expect(result.triggers.has("spelling")).toBe(false);
    });
  });

  describe("detectTriggers - symbols", () => {
    it("detects symbol keywords", () => {
      const result = detectTriggers("Add an at symbol before the name");
      expect(result.triggers.has("symbols")).toBe(true);
      expect(result.metadata.symbols?.matches).toHaveLength(1);
      expect(result.metadata.symbols?.matches[0].keyword).toMatch(/symbol/i);
    });

    it("detects hashtag", () => {
      const result = detectTriggers("Use a hashtag for the tag");
      expect(result.triggers.has("symbols")).toBe(true);
      expect(result.metadata.symbols?.matches.length).toBeGreaterThanOrEqual(1);
    });

    it("detects multiple symbol references", () => {
      const result = detectTriggers("Add a dollar sign and a percent symbol");
      expect(result.triggers.has("symbols")).toBe(true);
      expect(result.metadata.symbols?.matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("detectTriggers - casing", () => {
    it("detects uppercase instruction", () => {
      const result = detectTriggers("Make this uppercase please");
      expect(result.triggers.has("casing")).toBe(true);
      expect(result.metadata.casing?.instructions[0].keyword).toBe("uppercase");
    });

    it("detects caps variations", () => {
      const result1 = detectTriggers("Put it in caps");
      expect(result1.triggers.has("casing")).toBe(true);

      const result2 = detectTriggers("Use all caps for emphasis");
      expect(result2.triggers.has("casing")).toBe(true);
    });

    it("detects lowercase instruction", () => {
      const result = detectTriggers("Convert to lowercase");
      expect(result.triggers.has("casing")).toBe(true);
      expect(result.metadata.casing?.instructions[0].keyword).toBe("lowercase");
    });

    it("detects capitalize variants", () => {
      const result = detectTriggers("Make sure to capitalize the first letter");
      expect(result.triggers.has("casing")).toBe(true);
    });
  });

  describe("detectTriggers - quotes", () => {
    it("detects quote wrapping instruction", () => {
      const result = detectTriggers("Put the word in quotes");
      expect(result.triggers.has("quotes")).toBe(true);
      expect(result.metadata.quotes?.matches).toHaveLength(1);
    });

    it("detects quote-unquote", () => {
      const result = detectTriggers("He said quote unquote the best");
      expect(result.triggers.has("quotes")).toBe(true);
    });
  });

  describe("detectTriggers - disfluency", () => {
    it("detects sorry correction", () => {
      const result = detectTriggers("I want to go to the store sorry the park");
      expect(result.triggers.has("disfluency")).toBe(true);
      expect(result.metadata.disfluency?.corrections[0].keyword).toBe("sorry");
    });

    it("detects wait no", () => {
      const result = detectTriggers("Turn left wait no turn right");
      expect(result.triggers.has("disfluency")).toBe(true);
      expect(result.metadata.disfluency?.corrections[0].keyword).toMatch(
        /wait no/i,
      );
    });

    it("detects scratch that", () => {
      const result = detectTriggers(
        "Send it to John scratch that send it to Jane",
      );
      expect(result.triggers.has("disfluency")).toBe(true);
    });

    it("detects I mean", () => {
      const result = detectTriggers("The meeting is at 3 I mean at 4");
      expect(result.triggers.has("disfluency")).toBe(true);
    });

    it("detects actually", () => {
      const result = detectTriggers(
        "Set the color to blue actually make it red",
      );
      expect(result.triggers.has("disfluency")).toBe(true);
    });

    it("detects oops", () => {
      const result = detectTriggers("Delete the file oops dont do that");
      expect(result.triggers.has("disfluency")).toBe(true);
    });
  });

  describe("detectTriggers - lists (numeric)", () => {
    it("detects numeric lists with 3+ items", () => {
      const result = detectTriggers(
        "First item is 1 buy milk, 2 walk the dog, 3 finish report",
      );
      expect(result.triggers.has("list")).toBe(true);
      expect(result.metadata.list?.format).toBe("numeric");
      expect(result.metadata.list?.items).toHaveLength(3);
    });

    it("requires at least 3 items", () => {
      const result = detectTriggers("Two items: 1 buy milk, 2 walk dog");
      expect(result.triggers.has("list")).toBe(false);
    });

    it("detects longer numeric lists", () => {
      const result = detectTriggers(
        "Tasks: 1 email, 2 call, 3 meeting, 4 report, 5 review",
      );
      expect(result.triggers.has("list")).toBe(true);
      expect(result.metadata.list?.items).toHaveLength(5);
    });

    it("breaks on non-consecutive numbers", () => {
      const result = detectTriggers("Items: 1 first, 3 third, 4 fourth");
      // Should not detect as valid list since 2 is missing
      expect(result.triggers.has("list")).toBe(false);
    });

    it("extracts item text correctly", () => {
      const result = detectTriggers(
        "List: 1 buy groceries, 2 clean house, 3 do laundry",
      );
      expect(result.triggers.has("list")).toBe(true);
      expect(result.metadata.list?.items[0].text).toContain("buy groceries");
      expect(result.metadata.list?.items[1].text).toContain("clean house");
      expect(result.metadata.list?.items[2].text).toContain("do laundry");
    });
  });

  describe("detectTriggers - lists (ordinal)", () => {
    it("detects ordinal lists", () => {
      const result = detectTriggers(
        "Steps: first turn on computer, second open browser, third navigate to site",
      );
      expect(result.triggers.has("list")).toBe(true);
      expect(result.metadata.list?.format).toBe("ordinal");
      expect(result.metadata.list?.items).toHaveLength(3);
    });

    it("requires consecutive ordinals", () => {
      const result = detectTriggers(
        "Items: first one, third three, fourth four",
      );
      expect(result.triggers.has("list")).toBe(false);
    });

    it("detects longer ordinal lists", () => {
      const result = detectTriggers(
        "First task, second task, third task, fourth task, fifth task",
      );
      expect(result.triggers.has("list")).toBe(true);
      expect(result.metadata.list?.items).toHaveLength(5);
    });
  });

  describe("detectTriggers - lists (alphabetic)", () => {
    it("detects alphabetic lists", () => {
      const result = detectTriggers(
        "Options: a choice one, b choice two, c choice three",
      );
      expect(result.triggers.has("list")).toBe(true);
      expect(result.metadata.list?.format).toBe("alphabetic");
      expect(result.metadata.list?.items).toHaveLength(3);
    });

    it("requires consecutive letters", () => {
      const result = detectTriggers("Items: a first, c third, d fourth");
      expect(result.triggers.has("list")).toBe(false);
    });
  });

  describe("detectTriggers - multiple triggers", () => {
    it("detects multiple triggers in same text", () => {
      const result = detectTriggers(
        "Make it uppercase and add an at symbol, also spell C L A U D E",
      );
      expect(result.triggers.has("casing")).toBe(true);
      expect(result.triggers.has("symbols")).toBe(true);
      expect(result.triggers.has("spelling")).toBe(true);
      expect(result.triggers.size).toBe(3);
    });

    it("detects list with corrections", () => {
      const result = detectTriggers(
        "first buy milk, second walk dog, third clean house, sorry actually first is buy bread",
      );
      expect(result.triggers.has("list")).toBe(true);
      expect(result.triggers.has("disfluency")).toBe(true);
    });
  });

  describe("detectTriggers - edge cases", () => {
    it("handles empty string", () => {
      const result = detectTriggers("");
      expect(result.triggers.size).toBe(0);
      expect(result.requiresLLM).toBe(false);
    });

    it("handles whitespace-only string", () => {
      const result = detectTriggers("   \n  \t  ");
      expect(result.triggers.size).toBe(0);
      expect(result.requiresLLM).toBe(false);
    });

    it("handles clean dictation with no triggers", () => {
      const result = detectTriggers(
        "This is a perfectly normal sentence with no special instructions whatsoever.",
      );
      expect(result.triggers.size).toBe(0);
      expect(result.requiresLLM).toBe(false);
    });

    it("is case insensitive for keywords", () => {
      const result = detectTriggers("MAKE THIS UPPERCASE AND SPELL IT");
      expect(result.triggers.has("casing")).toBe(true);
      expect(result.triggers.has("spelling")).toBe(true);
    });
  });

  describe("requiresLLM flag", () => {
    it("is true when any trigger fires", () => {
      const result = detectTriggers("Make it uppercase");
      expect(result.requiresLLM).toBe(true);
    });

    it("is false when no triggers fire", () => {
      const result = detectTriggers("Just normal dictation here");
      expect(result.requiresLLM).toBe(false);
    });
  });
});
