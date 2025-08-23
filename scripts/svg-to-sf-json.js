#!/usr/bin/env node
/**
 * Convert a simple SVG file (single <path>) into an entry compatible with public/assets/sf-symbols.json
 *
 * Usage:
 *   node scripts/svg-to-sf-json.js <svgPath> <iconName> [--weight bold] [--json public/assets/sf-symbols.json] [--merge]
 *
 * Examples:
 *   node scripts/svg-to-sf-json.js public/assets/accessibility.svg accessibility --merge
 *   node scripts/svg-to-sf-json.js ./icon.svg my.icon.name --weight regular
 */
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {
    svgPath: undefined,
    iconName: undefined,
    weight: "bold",
    jsonPath: path.resolve(process.cwd(), "public/assets/sf-symbols.json"),
    merge: false,
  };

  const positional = [];
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--merge") {
      args.merge = true;
      continue;
    }
    if (token === "--weight") {
      args.weight = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--json") {
      args.jsonPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    positional.push(token);
  }

  if (positional.length < 2) {
    console.error(
      "Usage: node scripts/svg-to-sf-json.js <svgPath> <iconName> [--weight bold] [--json public/assets/sf-symbols.json] [--merge]",
    );
    process.exit(1);
  }
  args.svgPath = path.resolve(process.cwd(), positional[0]);
  args.iconName = positional[1];
  return args;
}

function extractViewBox(svg) {
  const viewBoxMatch = svg.match(
    /viewBox=["']([\d.+\-eE]+)\s+([\d.+\-eE]+)\s+([\d.+\-eE]+)\s+([\d.+\-eE]+)["']/,
  );
  if (!viewBoxMatch) return null;
  const [, , , widthStr, heightStr] = viewBoxMatch; // ignore minX/minY
  const width = Number(widthStr);
  const height = Number(heightStr);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function extractPathD(svg) {
  // Prefer the first <path ... d="..."> occurrence
  const dDouble = svg.match(/<path[^>]*\sd=["]([^"\\]*(?:\\.[^"\\]*)*)["]/);
  if (dDouble) return dDouble[1];
  const dSingle = svg.match(/<path[^>]*\sd=[\']([^\'\\]*(?:\\.[^\'\\]*)*)[\']/);
  if (dSingle) return dSingle[1];
  return null;
}

function main() {
  const { svgPath, iconName, weight, jsonPath, merge } = parseArgs(
    process.argv,
  );
  const svg = fs.readFileSync(svgPath, "utf8");

  const geometry = extractViewBox(svg);
  if (!geometry) {
    console.error(
      'Could not parse viewBox from SVG. Ensure it contains viewBox="minX minY width height".',
    );
    process.exit(2);
  }

  const d = extractPathD(svg);
  if (!d) {
    console.error(
      'Could not find a <path d="..."> element in the SVG. Multiple paths are not supported by this simple converter.',
    );
    process.exit(3);
  }

  const entry = {
    [iconName]: {
      [weight]: {
        path: d,
        geometry: {
          width: geometry.width,
          height: geometry.height,
        },
      },
    },
  };

  if (!merge) {
    // Print JSON snippet to stdout
    process.stdout.write(JSON.stringify(entry, null, 2) + "\n");
    return;
  }

  // Merge into the target JSON file
  let current = {};
  if (fs.existsSync(jsonPath)) {
    try {
      current = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (e) {
      console.error(`Failed to read or parse JSON at ${jsonPath}:`, e.message);
      process.exit(4);
    }
  }

  if (!current[iconName]) current[iconName] = {};
  current[iconName][weight] = entry[iconName][weight];

  fs.writeFileSync(jsonPath, JSON.stringify(current, null, 2) + "\n");
  console.log(`Merged '${iconName}' (${weight}) into ${jsonPath}`);
}

main();
