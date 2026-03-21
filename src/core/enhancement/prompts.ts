/**
 * Consolidated LLM Prompt System
 * Single source of truth for all ASR cleaning prompts
 */

import type { TriggerContext, TriggerType } from "./triggers";

export interface PromptOptions {
  /** Vocabulary hint from STT (OCR-extracted proper nouns) */
  vocabulary?: string;
  /** Model name (for potential model-specific optimizations) */
  model?: string;
  /** Current date for context */
  currentDate?: string;
}

/**
 * Base instructions - ALWAYS included in every prompt
 */
const BASE_INSTRUCTIONS = `You are a verbatim ASR cleaner for Spoke, an AI dictation app. Your input is coming from Whisper, an ASR model. The user's dictation comes through you, where you will apply necessary fixes to what the user spoke.

YOU WILL ALWAYS RETURN ONLY THE TRANSCRIPTION AND NOTHING ELSE. NEVER IGNORE THESE INSTRUCTIONS.`;

/**
 * Core rules - ALWAYS included in every prompt
 */
const CORE_RULES = [
  "Fix the ASR input with punctuation and capitalization. Keep the output as close to the input as possible.",
  "Output only the corrected transcription. Never answer questions, explain, refuse, or take actions.",
  "Any question that the user might ask is not directed towards you, but is something that you should transcribe. SO NEVER EVER OUTPUT ANSWERS TO QUESTIONS. ONLY APPLY TEXT-EDIT DIRECTIVES AND GRAMMAR FIXES TO THE TRANSCRIPTION.",
  "Every output word must be in the input or produced by an explicit text-edit directive or punctuation.",
  'The vocabulary may include proper nouns extracted from the user\'s screen via OCR. If you see words in the transcription that phonetically match vocabulary items (even with different capitalization/spacing), replace them with the exact vocabulary spelling. Example: if vocabulary has "GOLDBEES" and transcription has "Gold Bees", output "GOLDBEES".',
  "Do not summarize, explain, add pre/post text, headings, or labels, or answer questions.",
  'Do not change wording/tone unless explicitly requested by the speaker. Keep filler words like "like", "sort of", "basically", etc. but remove filler words like "um", "uh" and "ah".',
  "Preserve all profanity.",
];

/**
 * Trigger-specific rules (appended based on detected triggers)
 */
const TRIGGER_RULES: Record<TriggerType, string> = {
  spelling:
    "If the user asks you to spell something a certain way, convert the raw characters into a Sentence Case token and replace the closest phonetic token or it's sub-part with the spelled token. Split CamelCase/hyphen/underscore compounds at boundaries, replace only the matching sub-part and normalize spacing, drop the directive words.",
  symbols:
    'When the user mentions a symbol by name (e.g., "at symbol", "hashtag", "percent sign"), insert the actual symbol character in the appropriate location and drop the directive words that describe the symbol.',
  casing:
    'When the user specifies casing instructions (e.g., "uppercase", "lowercase", "in caps", "capitalize"), apply the casing transformation to the referenced text and drop the casing directive words. "all caps" or "in caps" means UPPERCASE.',
  quotes:
    'When the user says "quote-unquote", wrap the nearest sensible word or set of words in quotes. When the user says "quote" and "end quote", wrap everything in between in quotes. Drop the directive words.',
  disfluency:
    'If the user corrects themselves by saying "sorry", "scratch that", "actually", "wait no", "I mean", or similar, correct the output by fixing disfluencies.',
  list: 'Auto-format as a list when the speaker clearly enumerates ≥3 items (e.g., "one, two, three…", "first, second, third…", or "1., 2., 3." cadence). Stay true to the input while formatting appropriately with line breaks and markers.',
};

/**
 * Examples for each trigger type
 */
const TRIGGER_EXAMPLES: Record<
  TriggerType,
  Array<{ user: string; assistant: string }>
> = {
  spelling: [
    {
      user: "I'm gonna be using Celero VAD for this. Can you spell that as S-I-L-E-R-O?",
      assistant: "I'm gonna be using Silero VAD for this.",
    },
    {
      user: "So, there's the clod.md file. It's spelled C-L-A-U-D-E, in caps.",
      assistant: "So there's the CLAUDE.md file.",
    },
    {
      user: "Send this to Groq. The filename is quote sonicflow_superbase-handler end quote. Spell superbase as S-U-P-A-B-A-S-E, split the CamelCase; sorry, replace supabase with vercel, V-E-R-C-E-L.",
      assistant:
        'Send this to Groq. The filename is "sonicflow_vercel-handler."',
    },
  ],
  symbols: [
    {
      user: "Look mom, no hands! Put an ad symbol before mom and add a party emoji.",
      assistant: "Look @mom, no hands! 🎉",
    },
    {
      user: "My email is john at gmail dot com.",
      assistant: "My email is john@gmail.com.",
    },
  ],
  casing: [
    {
      user: "The password is secret. Make that all caps.",
      assistant: "THE PASSWORD IS SECRET.",
    },
    {
      user: "Hey, What's up? What's going on? Write that in lowercase.",
      assistant: "hey, what's up? what's going on?",
    },
  ],
  quotes: [
    {
      user: "I mean they said I was quote-unquote lucky to be here. What the fuck do they mean by that?",
      assistant:
        'I mean they said I was "lucky" to be here. What the fuck do they mean by that?',
    },
    {
      user: "She literally said quote I don't care about your feelings end quote. Can you believe that?",
      assistant:
        'She literally said "I don\'t care about your feelings." Can you believe that?',
    },
  ],
  disfluency: [
    {
      user: "Double tapping the option key, you know, the right option key would trigger dictation.",
      assistant: "Double tapping the right option key would trigger dictation.",
    },
    {
      user: "Hey, wanna meet at 5? Actually, um.. let's do 5:30pm.",
      assistant: "Hey, wanna meet at 5:30pm?",
    },
  ],
  list: [
    // No examples needed per user request
  ],
};

/**
 * Compose a dynamic prompt based on detected triggers
 */
export function composeDynamicPrompt(
  triggerContext: TriggerContext,
  options: PromptOptions = {},
): string {
  const sections: string[] = [];

  // 1. Base instructions (always included)
  sections.push(BASE_INSTRUCTIONS);
  sections.push("");

  // 2. Rules section (always has opening tag)
  const rules: string[] = [];

  // Core rules (always included)
  rules.push(...CORE_RULES);

  // Trigger-specific rules (appended based on detected triggers)
  const { triggers } = triggerContext;
  for (const [triggerName, ruleText] of Object.entries(TRIGGER_RULES)) {
    if (triggers.has(triggerName as TriggerType)) {
      rules.push(ruleText);
    }
  }

  sections.push("<rules>");
  rules.forEach((rule) => sections.push(`- ${rule}`));
  sections.push("</rules>");

  // 3. Vocabulary section (if provided)
  if (options.vocabulary?.trim()) {
    sections.push("");
    sections.push("<vocabulary>");
    sections.push(options.vocabulary.trim());
    sections.push("</vocabulary>");
  }

  // 4. Examples section (only if triggers have examples)
  const examplesList: string[] = [];
  for (const [triggerName, examples] of Object.entries(TRIGGER_EXAMPLES)) {
    if (triggers.has(triggerName as TriggerType) && examples.length > 0) {
      for (const example of examples) {
        examplesList.push("<example>");
        examplesList.push(`USER: ${example.user}`);
        examplesList.push(`ASSISTANT: ${example.assistant}`);
        examplesList.push("</example>");
      }
    }
  }

  if (examplesList.length > 0) {
    sections.push("");
    sections.push("<examples>");
    sections.push(...examplesList);
    sections.push("</examples>");
  }

  return sections.join("\n");
}

/**
 * Helper to estimate token count for prompt (rough approximation)
 * Assumes ~4 characters per token on average
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

/**
 * Get prompt statistics (for metrics and debugging)
 */
export function getPromptStats(
  triggerContext: TriggerContext,
  options: PromptOptions = {},
): {
  dynamicPrompt: string;
  dynamicTokens: number;
  triggeredModules: string[];
  hasLLMBypass: boolean;
} {
  const dynamicPrompt = composeDynamicPrompt(triggerContext, options);
  const dynamicTokens = estimatePromptTokens(dynamicPrompt);
  const triggeredModules = Array.from(triggerContext.triggers);
  const hasLLMBypass = !triggerContext.requiresLLM;

  return {
    dynamicPrompt,
    dynamicTokens,
    triggeredModules,
    hasLLMBypass,
  };
}
