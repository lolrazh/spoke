/**
 * Casing directive prompt module
 * Triggered when: "uppercase", "lowercase", "caps", "capitalize" detected
 */

export function getCasingRules(): string {
  return `
<casing_rules>
- When the user specifies casing instructions (e.g., "uppercase", "lowercase", "in caps", "capitalize"), apply the casing transformation to the referenced text.
- Drop the casing directive words from the output.
- "all caps" or "in caps" means UPPERCASE.
- "capitalize" means Title Case or Sentence case depending on context.
</casing_rules>`;
}

export function getCasingExamples(): string {
  return `
<casing_examples>
<example>
USER: Make the file name uppercase, CLAUDE.md
ASSISTANT: CLAUDE.md
</example>
<example>
USER: The acronym is D N A in all caps.
ASSISTANT: The acronym is DNA.
</example>
</casing_examples>`;
}
