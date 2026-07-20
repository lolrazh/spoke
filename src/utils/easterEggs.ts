const BLOODY_MARY_PATTERN = /\bbloody\s+mary\b/gi;
const BLOODY_MARY_INVOCATION_COUNT = 3;

export function invokedBloodyMary(text: string): boolean {
  return (
    (text.match(BLOODY_MARY_PATTERN)?.length ?? 0) >=
    BLOODY_MARY_INVOCATION_COUNT
  );
}
