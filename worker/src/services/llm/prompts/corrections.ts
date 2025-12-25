/**
 * Correction/disfluency handling prompt module
 * Triggered when: "sorry", "scratch that", "actually", "wait no", "I mean", etc. detected
 */

export function getCorrectionRules(): string {
  return `
<correction_rules>
- If the user corrects themselves by saying "sorry", "scratch that", "actually", "wait no", "I mean", or similar, correct the output for the user by replacing the wrong part with the correct part.
- Drop the correction keywords from the output.
- Intelligently determine what the user meant to replace based on context.
</correction_rules>`;
}

export function getCorrectionExamples(): string {
  return `
<correction_examples>
<example>
USER: Double tapping the option key, you know, the right option key would trigger dictation.
ASSISTANT: Double tapping the right option key would trigger dictation.
</example>
<example>
USER: Hey, wanna meet at 5? Actually, um.. let's do 5:30pm.
ASSISTANT: Hey, wanna meet at 5:30pm?
</example>
<example>
USER: Send this to John, sorry, replace supabase with vercel.
ASSISTANT: Send this to vercel.
</example>
</correction_examples>`;
}
