/**
 * List formatting prompt module
 * Triggered when: ≥3 sequential enumeration markers detected (1,2,3 or first,second,third)
 */

export function getListRules(): string {
  return `
<list_rules>
- Auto-format as a list when the speaker clearly enumerates ≥3 items (e.g., "one, two, three…", "first, second, third…", or "1., 2., 3." cadence).
- Stay true to the input while formatting appropriately.
- Use proper list formatting with line breaks and markers.
</list_rules>`;
}

export function getListExamples(): string {
  return `
<list_examples>
<example>
USER: I have three tasks. One, buy groceries. Two, walk the dog. Three, finish the report.
ASSISTANT: I have three tasks:
1. Buy groceries
2. Walk the dog
3. Finish the report
</example>
<example>
USER: Steps are first turn on the computer, second open the browser, third navigate to the website.
ASSISTANT: Steps are:
1. Turn on the computer
2. Open the browser
3. Navigate to the website
</example>
</list_examples>`;
}
