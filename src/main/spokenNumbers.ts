/** Direct English number parsing. Invalid or ambiguous sequences stay intact. */
const SMALL = [
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
const TENS = [
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
const VALUES = new Map([
  ...SMALL.map((word, index) => [word, index] as const),
  ...TENS.map((word, index) => [word, (index + 2) * 10] as const),
  ["oh", 0] as const,
]);
const SCALES = new Map([
  ["thousand", 1e3],
  ["million", 1e6],
  ["billion", 1e9],
]);
const TOKEN = `(?:${[...VALUES.keys(), "hundred", ...SCALES.keys()].join("|")})`;
const PHRASE = `${TOKEN}(?:[ -]+(?:and[ -]+)?${TOKEN})*`;
const NUMBERS = new RegExp(
  `\\b(?:(?:minus|negative)[ ]+)?(?:${PHRASE}(?:[ ]+point[ ]+${PHRASE})*|point[ ]+${PHRASE})\\b`,
  "giu",
);
const UNITS: Record<string, string> = {
  byte: "B",
  bytes: "B",
  kilobyte: "KB",
  kilobytes: "KB",
  megabyte: "MB",
  megabytes: "MB",
  gigabyte: "GB",
  gigabytes: "GB",
  terabyte: "TB",
  terabytes: "TB",
  kb: "KB",
  mb: "MB",
  gb: "GB",
  tb: "TB",
  millisecond: "ms",
  milliseconds: "ms",
  microsecond: "µs",
  microseconds: "µs",
  nanosecond: "ns",
  nanoseconds: "ns",
  kilogram: "kg",
  kilograms: "kg",
  gram: "g",
  grams: "g",
  kilometer: "km",
  kilometers: "km",
  centimetre: "cm",
  centimetres: "cm",
  centimeter: "cm",
  centimeters: "cm",
  millimeter: "mm",
  millimeters: "mm",
};
const UNIT_PATTERN = new RegExp(
  `^[ ]+(${Object.keys(UNITS).join("|")})\\b`,
  "iu",
);
const WRITTEN_UNITS = new RegExp(
  `\\b(\\d+(?:\\.\\d+)?)[ ]+(${Object.keys(UNITS).join("|")})\\b`,
  "giu",
);
const COUNT_UNITS =
  /^[ ]+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|files?|people|requests?|items?|times?|dollars?|euros?|pounds?|cents?|percent|per cent|degrees?)\b/iu;
const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
};
const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";
const DATES = new RegExp(
  `\\b(${MONTHS})[ ]+((?:twenty[ -]|thirty[ -])?(?:${Object.keys(ORDINALS).join("|")}))\\b`,
  "giu",
);
const AFTER_ORDINAL = new RegExp(
  `^[ -]+(?:${Object.keys(ORDINALS).join("|")})\\b`,
  "iu",
);
const YEAR_CONTEXT = new RegExp(
  `\\b(?:year|(?:${MONTHS})[ ]+\\d{1,2})[ ,]+$`,
  "iu",
);
const VERSIONS = new RegExp(
  `\\b(version|v)[ ]+(${PHRASE}(?:[ ]+point[ ]+${PHRASE})+)\\b`,
  "giu",
);
const MIXED_FRACTION = new RegExp(
  `\\b(${PHRASE})[ ]+and[ ]+a[ ]+(half|quarter)\\b`,
  "giu",
);

function words(phrase: string): string[] {
  return phrase.toLowerCase().split(/[ -]+/u);
}

function underHundred(tokens: string[]): number | null {
  if (tokens.length === 1) return VALUES.get(tokens[0]) ?? null;
  if (tokens.length !== 2) return null;
  const tens = VALUES.get(tokens[0]);
  const unit = VALUES.get(tokens[1]);
  return tens !== undefined &&
    tens >= 20 &&
    unit !== undefined &&
    unit > 0 &&
    unit < 10
    ? tens + unit
    : null;
}

function underThousand(tokens: string[]): number | null {
  if (tokens[1] !== "hundred") return underHundred(tokens);
  const hundreds = VALUES.get(tokens[0]);
  if (hundreds === undefined || hundreds < 1 || hundreds > 9) return null;
  let rest = tokens.slice(2);
  if (rest[0] === "and") rest = rest.slice(1);
  const remainder = rest.length ? underHundred(rest) : 0;
  return remainder === null ? null : hundreds * 100 + remainder;
}

export function parseSpokenCardinal(phrase: string): number | null {
  const tokens = words(phrase);
  let total = 0;
  let previousScale = Infinity;
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    const scale = SCALES.get(tokens[i]);
    if (scale === undefined) continue;
    const group = underThousand(tokens.slice(start, i));
    if (scale >= previousScale || group === null || group === 0) return null;
    total += group * scale;
    previousScale = scale;
    start = i + 1;
    if (tokens[start] === "and") start++;
  }
  const remainder =
    start === tokens.length ? 0 : underThousand(tokens.slice(start));
  return remainder === null ? null : total + remainder;
}

function digits(tokens: string[]): string | null {
  const numbers = tokens.map((token) => VALUES.get(token));
  return numbers.every((number) => number !== undefined && number < 10)
    ? numbers.join("")
    : null;
}

function identifier(phrase: string): string | null {
  const tokens = words(phrase);
  if (tokens.length > 1) {
    const sequence = digits(tokens);
    if (sequence !== null) return sequence;
    const first = VALUES.get(tokens[0]);
    const rest = underHundred(tokens.slice(1));
    // PR two thirty one -> 231, PR twelve thirty four -> 1234.
    if (first !== undefined && first > 0 && rest !== null && rest >= 10)
      return `${first}${rest}`;
  }
  const cardinal = parseSpokenCardinal(phrase);
  return cardinal === null ? null : String(cardinal);
}

function decimal(phrase: string): string | null {
  if (/^point /iu.test(phrase)) phrase = `zero ${phrase}`;
  const [integer, fraction, extra] = phrase.split(/ point /iu);
  if (extra !== undefined) return null;
  const value = parseSpokenCardinal(integer);
  if (value === null) return null;
  if (fraction === undefined) return String(value);
  const tail = digits(words(fraction));
  return tail === null ? null : `${value}.${tail}`;
}

function clock(phrase: string): string | null {
  const tokens = words(phrase);
  const hour = VALUES.get(tokens[0]);
  if (hour === undefined || hour < 1 || hour > 12) return null;
  if (tokens.length === 1) return String(hour);
  let minuteTokens = tokens.slice(1);
  if (
    minuteTokens.length > 1 &&
    (minuteTokens[0] === "oh" || minuteTokens[0] === "zero")
  )
    minuteTokens = minuteTokens.slice(1);
  const minute = underHundred(minuteTokens);
  return minute === null || minute > 59
    ? null
    : `${hour}:${String(minute).padStart(2, "0")}`;
}

function normalizeUnquotedNumbers(text: string): string {
  // Dates use a separate bounded pattern so a date ordinal is not treated as
  // an ordinary adjective ("first draft", "second thought").
  text = text.replace(
    DATES,
    (match, month: string, day: string, offset: number, source: string) => {
      if (
        /^(may|march)$/u.test(month) &&
        !/\b(?:on|in|date|until|by)[ ]+$/iu.test(
          source.slice(Math.max(0, offset - 12), offset),
        )
      )
        return match;
      const parts = words(day);
      const ordinal = ORDINALS[parts.at(-1)!];
      const tens = parts.length > 1 ? VALUES.get(parts[0]) : 0;
      const value = ordinal + (tens ?? 0);
      return value > 31
        ? match
        : `${month[0].toUpperCase()}${month.slice(1).toLowerCase()} ${value}`;
    },
  );
  text = text.replace(VERSIONS, (match, prefix: string, version: string) => {
    const parts = version.split(/ point /iu);
    const major = parseSpokenCardinal(parts.shift()!);
    const rest = parts.map((part) => {
      const sequence = digits(words(part));
      const cardinal = parseSpokenCardinal(part);
      return sequence ?? (cardinal === null ? null : String(cardinal));
    });
    return major === null || rest.some((part) => part === null)
      ? match
      : `${prefix} ${[major, ...rest].join(".")}`;
  });
  text = text.replace(
    MIXED_FRACTION,
    (match, cardinal: string, fraction: string) => {
      const value = parseSpokenCardinal(cardinal);
      return value === null
        ? match
        : String(value + (fraction.toLowerCase() === "half" ? 0.5 : 0.25));
    },
  );
  return text.replace(
    NUMBERS,
    (match: string, offset: number, source: string) => {
      const end = offset + match.length;
      const before = source.slice(Math.max(0, offset - 32), offset);
      const after = source.slice(end, end + 80);
      const negative = /^(minus|negative) /iu.test(match);
      const phrase = match.replace(/^(minus|negative) /iu, "");
      if (/\bPR[ ]+(?:number[ ]+)?#?[ ]*$/iu.test(before)) {
        return negative ? match : (identifier(phrase) ?? match);
      }
      if (YEAR_CONTEXT.test(before)) return identifier(phrase) ?? match;
      if (AFTER_ORDINAL.test(after)) return match;
      const meridiem = after.match(/^[ ]+([ap])\.?[ ]*m\.?\b/iu);
      if (
        !negative &&
        (meridiem || /\b(?:at|by|until|around)[ ]+$/iu.test(before))
      ) {
        const time = clock(phrase);
        if (time !== null && (meridiem || time.includes(":"))) return time;
        if (meridiem) return match;
      }
      let value = decimal(phrase);
      if (value === null) return match;
      if (negative) value = `-${value}`;
      const tokens = words(phrase);
      // Leave literal spelling, quotations, idioms, and standalone small numbers
      // alone unless a unit or explicit numeric label supplies intent.
      if (
        /["'“‘]$/u.test(before) ||
        /^["'”’]/u.test(after) ||
        /\b(?:word|say|spell|type|called)[ ]+$/iu.test(before)
      )
        return match;
      if (
        tokens.length === 1 &&
        Number(value) < 20 &&
        !COUNT_UNITS.test(after) &&
        !UNIT_PATTERN.test(after) &&
        !/\b(?:number|version|v|code)[ ]+$/iu.test(before)
      )
        return match;
      return value;
    },
  );
}

/** Do not rewrite text inside literal quotes or inline code. */
export function normalizeSpokenNumbers(text: string): string {
  return text.replace(
    /("[^"\n]*"|“[^”\n]*”|`[^`\n]*`)|([^"“`]+)/gu,
    (match, quoted: string | undefined) =>
      quoted ? match : normalizeUnquotedNumbers(match),
  );
}

function normalizeUnquotedNumberUnits(text: string): string {
  return text
    .replace(
      WRITTEN_UNITS,
      (_match, number: string, unit: string) =>
        `${number} ${UNITS[unit.toLowerCase()]}`,
    )
    .replace(/\b(\d+(?:\.\d+)?)[ ]+(?:percent|per cent|%)/giu, "$1%")
    .replace(
      /(?<![\w.])(-?\d+(?:\.\d+)?)[ ]+(dollars?|euros?|pounds?)\b/giu,
      (
        match,
        number: string,
        currency: string,
        offset: number,
        source: string,
      ) => {
        if (
          /^pound/iu.test(currency) &&
          /\b(?:weigh|weighs|weighed|weight)\b/iu.test(
            source.slice(Math.max(0, offset - 40), offset),
          )
        )
          return match;
        const symbol = currency.toLowerCase().startsWith("dollar")
          ? "$"
          : currency.toLowerCase().startsWith("euro")
            ? "€"
            : "£";
        return number.startsWith("-")
          ? `-${symbol}${number.slice(1)}`
          : `${symbol}${number}`;
      },
    )
    .replace(
      /([$€£])(\d+)[ ]+and[ ]+(\d{1,2})[ ]+cents?\b/giu,
      (_match, currency: string, integer: string, cents: string) =>
        `${currency}${integer}.${cents.padStart(2, "0")}`,
    )
    .replace(/\b(\d+)[ ]+cents?\b/giu, "$1¢")
    .replace(
      /\b(\d{1,2})(?:(?::|[ \t]+)(\d{2}))?[ \t]*([ap])\.?[ \t]*m\.?\b/giu,
      (match, hour: string, minutes: string | undefined, meridiem: string) => {
        if (
          Number(hour) < 1 ||
          Number(hour) > 12 ||
          (minutes && Number(minutes) > 59)
        )
          return match;
        return `${Number(hour)}${minutes ? `:${minutes}` : ""} ${meridiem.toUpperCase()}M`;
      },
    );
}

export function normalizeNumberUnits(text: string): string {
  return text.replace(
    /("[^"\n]*"|“[^”\n]*”|`[^`\n]*`)|([^"“`]+)/gu,
    (match, quoted: string | undefined) =>
      quoted ? match : normalizeUnquotedNumberUnits(match),
  );
}
