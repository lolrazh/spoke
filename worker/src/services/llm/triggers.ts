/**
 * Smart trigger detection for dynamic LLM routing
 * Combines regex patterns with stateful sequence detection
 */

export type TriggerType =
  | "spelling" // "spell X as Y-Z", "S-P-E-L-L"
  | "symbols" // "at symbol", "hashtag", "percent sign"
  | "casing" // "uppercase", "in caps", "lowercase"
  | "quotes" // "quote...unquote", "in quotes"
  | "disfluency" // "sorry", "wait no", "I mean", "scratch that"
  | "list"; // "1... 2... 3..." or "first... second... third..."

export interface TriggerContext {
  /** Which triggers fired */
  triggers: Set<TriggerType>;

  /** Metadata for each trigger type */
  metadata: {
    spelling?: {
      sequences: Array<{ start: number; end: number; text: string }>;
      instructions: Array<{ keyword: string; position: number }>;
    };
    symbols?: {
      matches: Array<{ keyword: string; position: number }>;
    };
    casing?: {
      instructions: Array<{ keyword: string; position: number }>;
    };
    quotes?: {
      matches: Array<{ start: number; end: number }>;
    };
    disfluency?: {
      corrections: Array<{ keyword: string; position: number; scope?: string }>;
    };
    list?: {
      items: Array<{ marker: string; position: number; text: string }>;
      format: "numeric" | "ordinal" | "alphabetic";
    };
  };

  /** Should LLM be invoked? */
  requiresLLM: boolean;
}

// ============================================================================
// Regex Patterns for Simple Triggers
// ============================================================================

/** Spelled sequences: "S-P-E-L-L" or "s p e l l" */
const SPELLED_SEQUENCE = /\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/i;

/** Spell instructions: "spell", "spelled", "spelling" */
const SPELL_INSTRUCTION = /\bspell(?:ing|ed)?\b/i;

/** Symbol keywords */
const SYMBOL_KEYWORDS =
  /\b(?:symbol|symbols|tag|hashtag|at sign|percent|ampersand|asterisk|dollar sign|plus sign|equals sign)\b/i;

/** Casing instructions */
const CASING_KEYWORDS =
  /\b(?:uppercase|lowercase|caps|capitals|capitalise|capitalised|capitalize|capitalized|all caps|in caps)\b/i;

/** Quote wrapping */
const QUOTE_PATTERNS =
  /\b(?:quote|quotes|in quotes|quote unquote|quote-unquote)\b/i;

/** Disfluency/correction keywords */
const DISFLUENCY_KEYWORDS =
  /\b(?:sorry|wait no|wait,? no|scratch that|I mean|actually|no wait|oops|my bad)\b/i;

// ============================================================================
// List Detection Patterns
// ============================================================================

/** Numeric list markers: "1", "2", "3", etc. */
const NUMERIC_LIST_MARKER = /\b(\d+)[\s.,:-]/g;

/** Ordinal list markers: "first", "second", "third", etc. */
const ORDINAL_LIST_MARKER =
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[\s.,:-]/gi;

/** Alphabetic list markers: "a", "b", "c", etc. */
const ALPHABETIC_LIST_MARKER = /\b([a-z])[\s.,:-]/gi;

// ============================================================================
// State Tracker for Sequential Patterns
// ============================================================================

interface ListCandidate {
  format: "numeric" | "ordinal" | "alphabetic";
  items: Array<{
    marker: string;
    position: number;
    text: string;
  }>;
}

class SequenceTracker {
  private listCandidates: ListCandidate[] = [];

  /**
   * Detects list patterns by tracking sequential markers
   * Returns true if ≥3 items in sequence detected
   */
  detectLists(text: string): ListCandidate | null {
    // Try numeric lists first
    const numericList = this.detectNumericList(text);
    if (numericList && numericList.items.length >= 3) {
      return numericList;
    }

    // Try ordinal lists
    const ordinalList = this.detectOrdinalList(text);
    if (ordinalList && ordinalList.items.length >= 3) {
      return ordinalList;
    }

    // Try alphabetic lists
    const alphabeticList = this.detectAlphabeticList(text);
    if (alphabeticList && alphabeticList.items.length >= 3) {
      return alphabeticList;
    }

    return null;
  }

  private detectNumericList(text: string): ListCandidate | null {
    const matches = Array.from(text.matchAll(NUMERIC_LIST_MARKER));
    if (matches.length < 3) return null;

    const items: ListCandidate["items"] = [];
    let expectedNum = 1;

    for (const match of matches) {
      const num = parseInt(match[1], 10);
      if (num === expectedNum) {
        const position = match.index!;
        const textAfter = text.slice(position + match[0].length);
        const nextMarkerMatch = textAfter.match(NUMERIC_LIST_MARKER);
        const itemText = nextMarkerMatch
          ? textAfter.slice(0, nextMarkerMatch.index).trim()
          : textAfter.trim();

        items.push({
          marker: match[1],
          position,
          text: itemText,
        });
        expectedNum++;
      } else {
        // Break sequence if numbers aren't consecutive
        break;
      }
    }

    return items.length >= 3 ? { format: "numeric", items } : null;
  }

  private detectOrdinalList(text: string): ListCandidate | null {
    const ordinals = [
      "first",
      "second",
      "third",
      "fourth",
      "fifth",
      "sixth",
      "seventh",
      "eighth",
      "ninth",
      "tenth",
    ];
    const matches = Array.from(text.matchAll(ORDINAL_LIST_MARKER));
    if (matches.length < 3) return null;

    const items: ListCandidate["items"] = [];
    let expectedIndex = 0;

    for (const match of matches) {
      const ordinal = match[1].toLowerCase();
      const actualIndex = ordinals.indexOf(ordinal);

      if (actualIndex === expectedIndex) {
        const position = match.index!;
        const textAfter = text.slice(position + match[0].length);
        const nextMarkerMatch = textAfter.match(ORDINAL_LIST_MARKER);
        const itemText = nextMarkerMatch
          ? textAfter.slice(0, nextMarkerMatch.index).trim()
          : textAfter.trim();

        items.push({
          marker: match[1],
          position,
          text: itemText,
        });
        expectedIndex++;
      } else {
        break;
      }
    }

    return items.length >= 3 ? { format: "ordinal", items } : null;
  }

  private detectAlphabeticList(text: string): ListCandidate | null {
    const matches = Array.from(text.matchAll(ALPHABETIC_LIST_MARKER));
    if (matches.length < 3) return null;

    const items: ListCandidate["items"] = [];
    let expectedChar = "a";

    for (const match of matches) {
      const char = match[1].toLowerCase();
      if (char === expectedChar) {
        const position = match.index!;
        const textAfter = text.slice(position + match[0].length);
        const nextMarkerMatch = textAfter.match(ALPHABETIC_LIST_MARKER);
        const itemText = nextMarkerMatch
          ? textAfter.slice(0, nextMarkerMatch.index).trim()
          : textAfter.trim();

        items.push({
          marker: match[1],
          position,
          text: itemText,
        });
        expectedChar = String.fromCharCode(expectedChar.charCodeAt(0) + 1);
      } else {
        break;
      }
    }

    return items.length >= 3 ? { format: "alphabetic", items } : null;
  }
}

// ============================================================================
// Main Trigger Detection
// ============================================================================

/**
 * Detects all triggers in the given text using hybrid regex + state approach
 *
 * @param text - STT output to analyze
 * @returns TriggerContext with detected triggers and metadata
 */
export function detectTriggers(text: string): TriggerContext {
  const normalized = text.trim();
  const triggers = new Set<TriggerType>();
  const metadata: TriggerContext["metadata"] = {};

  if (!normalized) {
    return { triggers, metadata, requiresLLM: false };
  }

  // ====== Simple Regex Triggers ======

  // Spelling
  const spelledSequences: Array<{ start: number; end: number; text: string }> =
    [];
  const spellInstructions: Array<{ keyword: string; position: number }> = [];

  let match: RegExpExecArray | null;

  // Find spelled sequences
  const spelledSeqRegex = new RegExp(SPELLED_SEQUENCE.source, "gi");
  while ((match = spelledSeqRegex.exec(normalized)) !== null) {
    spelledSequences.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    });
  }

  // Find spell instructions
  const spellInstRegex = new RegExp(SPELL_INSTRUCTION.source, "gi");
  while ((match = spellInstRegex.exec(normalized)) !== null) {
    spellInstructions.push({
      keyword: match[0],
      position: match.index,
    });
  }

  if (spelledSequences.length > 0 || spellInstructions.length > 0) {
    triggers.add("spelling");
    metadata.spelling = {
      sequences: spelledSequences,
      instructions: spellInstructions,
    };
  }

  // Symbols
  const symbolMatches: Array<{ keyword: string; position: number }> = [];
  const symbolRegex = new RegExp(SYMBOL_KEYWORDS.source, "gi");
  while ((match = symbolRegex.exec(normalized)) !== null) {
    symbolMatches.push({
      keyword: match[0],
      position: match.index,
    });
  }
  if (symbolMatches.length > 0) {
    triggers.add("symbols");
    metadata.symbols = { matches: symbolMatches };
  }

  // Casing
  const casingMatches: Array<{ keyword: string; position: number }> = [];
  const casingRegex = new RegExp(CASING_KEYWORDS.source, "gi");
  while ((match = casingRegex.exec(normalized)) !== null) {
    casingMatches.push({
      keyword: match[0],
      position: match.index,
    });
  }
  if (casingMatches.length > 0) {
    triggers.add("casing");
    metadata.casing = { instructions: casingMatches };
  }

  // Quotes
  const quoteMatches: Array<{ start: number; end: number }> = [];
  const quoteRegex = new RegExp(QUOTE_PATTERNS.source, "gi");
  while ((match = quoteRegex.exec(normalized)) !== null) {
    quoteMatches.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  if (quoteMatches.length > 0) {
    triggers.add("quotes");
    metadata.quotes = { matches: quoteMatches };
  }

  // Disfluency
  const disfluencyMatches: Array<{ keyword: string; position: number }> = [];
  const disfluencyRegex = new RegExp(DISFLUENCY_KEYWORDS.source, "gi");
  while ((match = disfluencyRegex.exec(normalized)) !== null) {
    disfluencyMatches.push({
      keyword: match[0],
      position: match.index,
    });
  }
  if (disfluencyMatches.length > 0) {
    triggers.add("disfluency");
    metadata.disfluency = { corrections: disfluencyMatches };
  }

  // ====== Stateful Triggers ======

  const tracker = new SequenceTracker();
  const listDetection = tracker.detectLists(normalized);

  if (listDetection) {
    triggers.add("list");
    metadata.list = {
      items: listDetection.items,
      format: listDetection.format,
    };
  }

  // ====== Decision: Requires LLM? ======

  const requiresLLM = triggers.size > 0;

  return {
    triggers,
    metadata,
    requiresLLM,
  };
}

/**
 * Helper to get human-readable trigger names for logging
 */
export function getTriggerNames(context: TriggerContext): string[] {
  return Array.from(context.triggers);
}
