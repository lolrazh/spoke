import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

// Compare indexed/cached matching with the unmodified main-branch algorithm.
const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "spoke-dictionary-parity-"));
const originalInfo = console.info;
try {
  const legacy = execFileSync(
    "git",
    [
      "show",
      "a6aa94a671d4ab0e14f9a6a9c1c6db86f1470741:src/main/dictionaryCorrection.ts",
    ],
    { encoding: "utf8" },
  );
  const frequencies = await readFile(
    "node_modules/subtlex-word-frequencies/index.json",
    "utf8",
  );
  const contents = legacy.replace(
    'import subtlexWords from "subtlex-word-frequencies";',
    `const subtlexWords = ${frequencies};`,
  );
  await build({
    stdin: {
      contents: `export { correctTranscript as optimized } from './dictionaryCorrection'; export { correctTranscript as reference } from 'reference';`,
      loader: "ts",
      resolveDir: path.join(root, "src/main"),
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: path.join(temp, "compare.mjs"),
    plugins: [
      {
        name: "original-matcher",
        setup(builder) {
          builder.onResolve({ filter: /^reference$/ }, () => ({
            path: "reference",
            namespace: "original",
          }));
          builder.onLoad({ filter: /.*/, namespace: "original" }, () => ({
            contents,
            loader: "ts",
            resolveDir: path.join(root, "src/main"),
          }));
        },
      },
    ],
  });
  const { optimized, reference } = await import(
    pathToFileURL(path.join(temp, "compare.mjs")).href
  );
  console.info = () => {};
  let comparisons = 0;
  let random = 234519;
  const word = (length) => {
    let result = "";
    for (let i = 0; i < length; i++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      result += "abcdefghijklmnopqrstuvwxyz"[random % 26];
    }
    return result;
  };
  const entries = Array.from({ length: 120 }, (_, i) =>
    word([5, 7, 9, 11, 12, 14, 21][i % 7]),
  );
  const dictionaries = [
    [
      "Sandheep",
      "Rajkumar",
      "RapidFuzz",
      "OpenAI",
      "ChatGPT",
      "ChargeBee",
      "R&D",
    ],
    entries,
    entries.map((entry) => entry[0].toUpperCase() + entry.slice(1)),
    entries.map(
      (entry) => entry.slice(0, 3) + entry[3].toUpperCase() + entry.slice(4),
    ),
  ];
  for (const dictionary of dictionaries) {
    for (const entry of [...dictionary, ...entries]) {
      const variants = [entry, entry.toUpperCase(), entry.toLowerCase()];
      for (let i = 0; i < entry.length; i++) {
        variants.push(entry.slice(0, i) + entry.slice(i + 1));
        variants.push(entry.slice(0, i) + "z" + entry.slice(i + 1));
        variants.push(entry.slice(0, i) + "z" + entry.slice(i));
      }
      for (const token of variants) {
        for (const text of [
          `Ask ${token} today`,
          `Use ${token.slice(0, 3)} ${token.slice(3)} now`,
        ]) {
          assert.equal(
            optimized(text, dictionary),
            reference(text, dictionary),
            JSON.stringify({ text, dictionary }),
          );
          comparisons++;
        }
      }
    }
  }
  console.log("Dictionary output parity:", comparisons, "comparisons passed");
} finally {
  console.info = originalInfo;
  await rm(temp, { recursive: true, force: true });
}
