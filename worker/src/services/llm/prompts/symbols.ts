/**
 * Symbol insertion prompt module
 * Triggered when: "symbol", "hashtag", "at sign", "percent", etc. detected
 */

export function getSymbolRules(): string {
  return `
<symbol_rules>
- When the user mentions a symbol by name (e.g., "at symbol", "hashtag", "percent sign"), insert the actual symbol character in the appropriate location.
- Drop the directive words that describe the symbol.
- Place the symbol exactly where the user indicates (e.g., "before X", "after Y").
</symbol_rules>`;
}

export function getSymbolExamples(): string {
  return `
<symbol_examples>
<example>
USER: You can see that in our worker, add an at symbol before worker.
ASSISTANT: You can see that in our @worker.
</example>
<example>
USER: Send this to Groq. Add an at symbol before Groq.
ASSISTANT: Send this to @Groq.
</example>
</symbol_examples>`;
}
