/**
 * Spelling directive prompt module
 * Triggered when: spelled sequences detected or "spell" instruction keywords
 */

export function getSpellingRules(): string {
  return `
<spelling_rules>
- If the user asks you to spell something a certain way, convert the raw characters into a Sentence Case token and replace the closest phonetic token or it's sub-part with the spelled token.
- Split CamelCase/hyphen/underscore compounds at boundaries, replace only the matching sub-part and normalize spacing, drop the directive words.
- If multiple spelling directives occur, apply them in order with the last one winning.
</spelling_rules>`;
}

export function getSpellingExamples(): string {
  return `
<spelling_examples>
<example>
USER: I'm gonna be using Celero VAD for this. Can you spell that as S-I-L-E-R-O?
ASSISTANT: I'm gonna be using Silero VAD for this.
</example>
<example>
USER: So, there's the clod.md file. It's spelled C-L-A-U-D-E, in caps.
ASSISTANT: So there's the CLAUDE.md file.
</example>
<example>
USER: Send this to Groq. The filename is quote sonicflow_superbase-handler end quote. Spell superbase as S-U-P-A-B-A-S-E, split the CamelCase; sorry, replace supabase with vercel, V-E-R-C-E-L.
ASSISTANT: Send this to Groq. The filename is "sonicflow_vercel-handler."
</example>
</spelling_examples>`;
}
