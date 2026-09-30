import { describe, expect, it } from "vitest";
import {
  parseSpokenCardinal,
  normalizeSpokenNumbers,
  normalizeNumberUnits,
} from "./spokenNumbers";

describe("direct spoken numbers", () => {
  it.each([
    ["zero", 0],
    ["twenty one", 21],
    ["two hundred thirty one", 231],
    ["one thousand and five", 1005],
    ["two million three hundred thousand forty two", 2300042],
    ["one two", null],
    ["twenty twenty", null],
    ["hundred", null],
    ["one thousand million", null],
    ["one hundred hundred", null],
  ])("parses %s", (input, expected) =>
    expect(parseSpokenCardinal(input)).toBe(expected),
  );

  it.each([
    ["review PR two thirty one", "review PR 231"],
    ["review PR two hundred thirty one", "review PR 231"],
    ["review PR two three one", "review PR 231"],
    ["review PR two 31", "review PR 231"],
    ["review PR 2 31", "review PR 231"],
    ["code two three one", "code 231"],
    [
      "phone number four one five five five five one two three four",
      "phone number 4155551234",
    ],
    ["review PR twelve thirty four", "review PR 1234"],
    ["meet me at two thirty one", "meet me at 2:31"],
    ["five thirty a m", "5:30 AM"],
    ["thirteen sixty a m", "thirteen sixty a m"],
    ["four hundred sixty four megabytes", "464 MB"],
    ["ninety percent", "90%"],
    ["version two point five", "version 2.5"],
    ["two point zero five dollars", "$2.05"],
    ["point five dollars", "$0.5"],
    ["five dollars and twenty cents", "$5.20"],
    ["version two point five point one", "version 2.5.1"],
    ["version two point five point twenty one", "version 2.5.21"],
    ["one point five point two", "one point five point two"],
    ["two and a half hours", "2.5 hours"],
    ["January fifth twenty twenty six", "January 5 2026"],
    ["the twenty first release", "the twenty first release"],
    ["we may first investigate", "we may first investigate"],
    ["on may first", "on May 1"],
    ["twenty twenty megabytes", "twenty twenty megabytes"],
    [
      'type "the cost is twenty one dollars"',
      'type "the cost is twenty one dollars"',
    ],
    ['type "5 dollars"', 'type "5 dollars"'],
    ["7 05 a m", "7:05 AM"],
    ["five milliseconds", "5 ms"],
    ["the package weighs ninety pounds", "the package weighs 90 pounds"],
    ["minus five dollars", "-$5"],
    ["January twenty first", "January 21"],
    ["first draft and second thought", "first draft and second thought"],
    ["one of the people", "one of the people"],
    ['type "twenty one"', 'type "twenty one"'],
    ["one\ntwo", "one\ntwo"],
    ["the phrase one two three", "the phrase one two three"],
  ])("writes %s", (input, expected) =>
    expect(normalizeNumberUnits(normalizeSpokenNumbers(input))).toBe(expected),
  );
});
