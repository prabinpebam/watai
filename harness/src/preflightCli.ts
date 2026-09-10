import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectLocalPreflight } from "./preflight.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, ".harness-state", "preflight.local.json");
const report = await collectLocalPreflight(root);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});

console.log(JSON.stringify({
  status: report.status,
  outputPath,
  repository: report.repository,
  blockers: report.blockers,
  observations: report.observations,
}, null, 2));