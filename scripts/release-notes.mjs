import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const RELEASE_NOTES_MARKER = "<!-- spoke-changelog:v1 -->";
const groups = [
  ["new", "What's New"],
  ["improved", "Improvements"],
  ["performance", "Performance"],
  ["fixed", "Fixes"],
];

function requireText(value, name, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\r\n]/u.test(value) || value.startsWith("#")) {
    throw new Error(`Invalid release note ${name}`);
  }
}

export function validateReleaseNotes(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Release notes must be a nonempty array");
  const versions = new Set();
  for (const entry of entries) {
    if (!entry || !/^\d+\.\d+\.\d+$/u.test(entry.version) || versions.has(entry.version)) {
      throw new Error("Invalid or duplicate release version");
    }
    versions.add(entry.version);
    requireText(entry.headline, "headline", 160);
    requireText(entry.summary, "summary", 1000);
    if (!Array.isArray(entry.items) || entry.items.length === 0) throw new Error(`Missing changes for ${entry.version}`);
    let previous = -1;
    const titles = new Set();
    for (const item of entry.items) {
      const rank = groups.findIndex(([type]) => type === item.type);
      if (rank < previous || rank < 0) throw new Error(`Invalid change order for ${entry.version}`);
      previous = rank;
      requireText(item.title, "item title", 160);
      requireText(item.description, "item description", 1500);
      if (titles.has(item.title)) throw new Error(`Duplicate change title for ${entry.version}`);
      titles.add(item.title);
    }
  }
  return entries;
}

export function renderReleaseNotes(entry) {
  validateReleaseNotes([entry]);
  const sections = [RELEASE_NOTES_MARKER, `# ${entry.headline}`, entry.summary];
  for (const [type, heading] of groups) {
    const items = entry.items.filter((item) => item.type === type);
    if (!items.length) continue;
    sections.push(`## ${heading}`);
    for (const item of items) sections.push(`### ${item.title}`, item.description);
  }
  const markdown = `${sections.join("\n\n")}\n`;
  if (markdown.length > 32_000) throw new Error("Release notes exceed the website's size limit");
  return markdown;
}

function main() {
  const args = process.argv.slice(2);
  let version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let output;
  let check = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--version" || arg === "--output") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--version") version = value;
      else output = value;
    } else if (arg === "--check") check = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const entries = validateReleaseNotes(JSON.parse(readFileSync(new URL("../releases/changelog.json", import.meta.url), "utf8")));
  const entry = entries.find((item) => item.version === version);
  if (!entry) throw new Error(`Write reviewed release notes for ${version} in releases/changelog.json before publishing`);
  const markdown = renderReleaseNotes(entry);
  if (check) {
    console.log(`Release notes validated for ${version} (${entries.length} catalog entries)`);
  } else if (output) writeFileSync(output, markdown);
  else process.stdout.write(markdown);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
