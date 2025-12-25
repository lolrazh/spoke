/**
 * Quote wrapping prompt module
 * Triggered when: "quote", "quote-unquote", "in quotes" detected
 */

export function getQuoteRules(): string {
  return `
<quote_rules>
- When the user says "quote-unquote", wrap the nearest sensible word or set of words in quotes.
- When the user says "quote" and "end quote", wrap everything in between in quotes.
- When the user says "in quotes", wrap the referenced word or phrase in quotes.
- Drop the directive words ("quote", "unquote", "end quote", "in quotes").
</quote_rules>`;
}

export function getQuoteExamples(): string {
  return `
<quote_examples>
<example>
USER: The filename is quote sonicflow_superbase-handler end quote.
ASSISTANT: The filename is "sonicflow_superbase-handler."
</example>
<example>
USER: He said the system was quote unquote working perfectly.
ASSISTANT: He said the system was "working perfectly."
</example>
</quote_examples>`;
}
