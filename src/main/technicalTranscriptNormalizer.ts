/** Join letter tokens before ITN can interpret them as units or identifiers. */
export function joinSpelledAcronyms(text: string): string {
  return text
    .replace(/\b[A-Za-z](?:[ \t]+[A-Za-z])+\b/gu, (sequence) => {
      const letters = sequence.split(/[ \t]+/u);
      // Keep the pronoun I separate from a following spelled acronym.
      const prefix = letters[0] === "I" ? `${letters.shift()} ` : "";
      const acronym = letters.join("");
      if (
        letters.length < 2 ||
        // Lowercase a/i can be ordinary words. Require stronger evidence for
        // lowercase letter runs, except the PR label used with a number below.
        (acronym !== acronym.toUpperCase() &&
          (letters.length < 3 ||
            letters.some((letter) => /^[ai]$/iu.test(letter))))
      ) {
        return sequence;
      }
      return prefix + acronym.toUpperCase();
    })
    .replace(
      /\bp[ \t]+r(?=[ \t]+(?:#|number\b|\d|zero\b|one\b|two\b|three\b|four\b|five\b|six\b|seven\b|eight\b|nine\b))/giu,
      "PR",
    );
}

/** A clock-shaped number immediately after a PR label is a reference ID. */
export function formatPullRequestReferences(text: string): string {
  return text.replace(
    /\bPR[ \t]+(?:number[ \t]+)?#?[ \t]*(\d{1,2}:\d{2}|\d+)(?![\d:]|\.\d|[ \t]*(?:[ap]\.?[ \t]*m\.?\b))/giu,
    (_match, number: string) => {
      const id = number.includes(":")
        ? number.replace(/^0(?=\d:)/u, "").replace(":", "")
        : number;
      return `PR #${id}`;
    },
  );
}
