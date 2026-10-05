import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { buildBlockMap } from "./blockmap.mjs";

const require = createRequire(import.meta.url);
const { computeOperations, OperationKind } = require(
  "electron-updater/out/differentialDownloader/downloadPlanBuilder",
);

const quietLog = { info() {}, debug() {}, warn() {}, error() {} };

test("a small edit downloads only the changed chunks, and rebuilds the exact new file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "blockmap-"));
  try {
    const oldBuf = randomBytes(2 * 1024 * 1024);
    const newBuf = Buffer.from(oldBuf);
    newBuf.fill(7, 1_000_000, 1_000_100);
    const oldFile = path.join(dir, "old.zip");
    const newFile = path.join(dir, "new.zip");
    writeFileSync(oldFile, oldBuf);
    writeFileSync(newFile, newBuf);

    await buildBlockMap(oldFile, "gzip", `${oldFile}.blockmap`);
    const result = await buildBlockMap(newFile, "gzip", `${newFile}.blockmap`);
    assert.equal(result.size, newBuf.length);
    assert.equal(result.sha512, createHash("sha512").update(newBuf).digest("base64"));

    const read = (f) => JSON.parse(gunzipSync(readFileSync(f)).toString());
    const ops = computeOperations(read(`${oldFile}.blockmap`), read(`${newFile}.blockmap`), quietLog);

    let downloaded = 0;
    const rebuilt = Buffer.concat(
      ops.map((op) => {
        if (op.kind === OperationKind.DOWNLOAD) downloaded += op.end - op.start;
        const source = op.kind === OperationKind.COPY ? oldBuf : newBuf;
        return source.subarray(op.start, op.end);
      }),
    );
    assert.ok(rebuilt.equals(newBuf));
    // Chunks average 16 KB and never exceed 32 KB, so a 100-byte edit
    // touches at most a couple of them.
    assert.ok(downloaded > 0 && downloaded <= 64 * 1024, `downloaded ${downloaded} bytes`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("requires an output path instead of appending to the zip", async () => {
  await assert.rejects(buildBlockMap("unused.zip", "gzip"), /outFile is required/);
});
