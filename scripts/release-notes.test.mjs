import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderReleaseNotes, validateReleaseNotes } from "./release-notes.mjs";

const entry = {
  version: "0.1.33", headline: "There Can Be Only One", summary: "Spoke Helper stays out of the Dock.",
  items: [{ type: "fixed", title: "One Spoke in Your Dock", description: "The helper runs in the background." }],
};

test("renders the website's versioned release-note contract", () => {
  assert.equal(renderReleaseNotes(entry), "<!-- spoke-changelog:v1 -->\n\n# There Can Be Only One\n\nSpoke Helper stays out of the Dock.\n\n## Fixes\n\n### One Spoke in Your Dock\n\nThe helper runs in the background.\n");
});

test("rejects missing notes, duplicate versions, invalid categories, and wrong group order", () => {
  assert.throws(() => validateReleaseNotes([]));
  assert.throws(() => validateReleaseNotes([entry, entry]));
  assert.throws(() => renderReleaseNotes({ ...entry, items: [] }));
  assert.throws(() => renderReleaseNotes({ ...entry, headline: "Heading\n## Injected Group" }));
  assert.throws(() => renderReleaseNotes({ ...entry, summary: "## Not a summary" }));
  assert.throws(() => renderReleaseNotes({ ...entry, items: [{ ...entry.items[0], type: "unknown" }] }));
  assert.throws(() => renderReleaseNotes({ ...entry, items: [...entry.items, { ...entry.items[0], type: "new", title: "Out of Order" }] }));
});

test("all authored release entries validate and render", () => {
  const entries = JSON.parse(readFileSync(new URL("../releases/changelog.json", import.meta.url), "utf8"));
  validateReleaseNotes(entries);
  for (const item of entries) assert.ok(renderReleaseNotes(item).includes(`# ${item.headline}`));
});
