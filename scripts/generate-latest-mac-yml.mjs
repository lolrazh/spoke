#!/usr/bin/env node
// Generate latest-mac.yml for electron-updater's GitHub provider.
//
// Electron Forge does not emit the manifest that electron-updater needs, so we
// build it here from the Squirrel ZIP that MakerZIP produced. The updater
// fetches latest-mac.yml from the latest GitHub Release, reads the zip filename
// and its base64 SHA-512, downloads that asset relative to the release, and
// verifies the digest before swapping the app.
//
// Correctness rules (a wrong manifest silently breaks every user's updater):
//   - url/path MUST be the exact asset filename PublisherGithub uploads, which
//     is the basename of the discovered zip. We never hardcode it.
//   - sha512 is the base64 (not hex) encoding of the raw SHA-512 digest.
//   - Fail loudly (non-zero exit) on zero or multiple zips so a broken release
//     can never ship a bad manifest.
//
// Usage: node scripts/generate-latest-mac-yml.mjs [--out <path>]
// Reads version from package.json. Writes latest-mac.yml in the repo root by
// default. Prints the exact zip it used to stdout.

import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

function fail(message) {
  console.error(`[generate-latest-mac-yml] ERROR: ${message}`);
  process.exit(1);
}

// Recursively collect *.zip files under out/make.
function findZips(dir) {
  let results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findZips(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip")) {
      results.push(full);
    }
  }
  return results;
}

const args = process.argv.slice(2);
let outPath = join(rootDir, "latest-mac.yml");
const outFlag = args.indexOf("--out");
if (outFlag !== -1) {
  if (!args[outFlag + 1]) fail("--out requires a path argument");
  outPath = args[outFlag + 1];
}

const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const version = pkg.version;
if (!version) fail("package.json has no version");

const makeDir = join(rootDir, "out", "make");
const zips = findZips(makeDir);

if (zips.length === 0) {
  fail(
    `no .zip found under ${makeDir}. Run electron-forge make first (MakerZIP produces the update zip).`,
  );
}
if (zips.length > 1) {
  fail(
    `expected exactly one .zip under ${makeDir}, found ${zips.length}:\n  ${zips.join("\n  ")}\nRefusing to guess which one the updater should use.`,
  );
}

const zipPath = zips[0];
const zipName = basename(zipPath);
const buf = readFileSync(zipPath);
const sha512 = createHash("sha512").update(buf).digest("base64");
const size = statSync(zipPath).size;
const releaseDate = new Date().toISOString();

// Build the manifest by hand. The shape must match electron-updater exactly:
// the modern files[] array plus the legacy top-level path/sha512 for older
// clients. quoteScalar guards filenames that YAML would otherwise misread.
function quoteScalar(value) {
  if (/^[A-Za-z0-9._-]+$/.test(value)) return value;
  return `'${String(value).replace(/'/g, "''")}'`;
}

const yml = [
  `version: ${version}`,
  `files:`,
  `  - url: ${quoteScalar(zipName)}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${quoteScalar(zipName)}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  ``,
].join("\n");

writeFileSync(outPath, yml, "utf8");

console.log(`[generate-latest-mac-yml] wrote ${outPath}`);
console.log(`[generate-latest-mac-yml] version: ${version}`);
console.log(`[generate-latest-mac-yml] zip:     ${zipPath}`);
console.log(`[generate-latest-mac-yml] asset:   ${zipName}`);
console.log(`[generate-latest-mac-yml] size:    ${size} bytes`);
console.log(`[generate-latest-mac-yml] sha512:  ${sha512}`);
