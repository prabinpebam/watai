import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectLocalPreflight } from "./preflight.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const report = await collectLocalPreflight(root);
const result = {
  status: report.packageSources.compliant ? "PASS" : "FAIL",
  approvedNpmRegistry: report.packageSources.approvedNpmRegistry,
  observedRegistries: report.packageSources.observedRegistries,
  violations: report.packageSources.violations,
};
console.log(JSON.stringify(result, null, 2));
if (!report.packageSources.compliant) process.exitCode = 1;