import { access, readFile } from "node:fs/promises";
import path from "node:path";

const outputs = [
  "dist/index.js",
  "dist/commands/runIndexingWorker.js",
  "dist/commands/processNextIndexingJob.js",
];

for (const output of outputs) {
  await access(path.resolve(output));
}

const worker = await readFile(path.resolve("dist/commands/runIndexingWorker.js"), "utf8");
if (/from ["'][^"']+\.ts["']/.test(worker) || /\btsx\b/.test(worker)) {
  throw new Error("Compiled indexing worker contains a TypeScript runtime dependency.");
}
