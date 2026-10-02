import { describe, expect, it } from "vitest";
import { parseSpokenCardinal, normalizeSpokenNumbers } from "./spokenNumbers";

const small = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const tens = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
function spoken(n: number): string {
  if (n < 20) return small[n];
  if (n < 100)
    return tens[Math.floor(n / 10)] + (n % 10 ? ` ${small[n % 10]}` : "");
  return `${small[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${spoken(n % 100)}` : ""}`;
}

describe("number grammar properties", () => {
  it("round trips all three-digit cardinal values", () => {
    for (let n = 0; n < 1000; n++) {
      expect(parseSpokenCardinal(spoken(n))).toBe(n);
      expect(normalizeSpokenNumbers(`PR ${spoken(n)}`)).toBe(`PR ${n}`);
    }
  });

  it("preserves leading zeroes when an identifier is spelled digit by digit", () => {
    for (let n = 0; n < 1000; n++) {
      const id = String(n).padStart(4, "0");
      const phrase = [...id].map((digit) => small[Number(digit)]).join(" ");
      expect(normalizeSpokenNumbers(`PR ${phrase}`)).toBe(`PR ${id}`);
    }
  });
});
