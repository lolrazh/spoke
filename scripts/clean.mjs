import { rmSync } from "node:fs";
import path from "node:path";

rmSync(path.resolve(process.cwd(), "out"), {
  force: true,
  recursive: true,
});
