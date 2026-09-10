import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectAuthorityContractDigests } from "./authorityInputs.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fileDigest = async (path: string) =>
  createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");

const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const rootInputs = await collectAuthorityContractDigests(root);

console.log(JSON.stringify({
  schemaVersion: "1.0",
  status: status ? "SOURCE_DIRTY" : "READY_FOR_OWNER_CEREMONY",
  releaseEligible: false,
  repositoryId: "prabinpebam/watai",
  sourceSha,
  clean: !status,
  rootInputs,
  observedBaseline: {
    path: "documentation/implementation/2026-09-10-autonomous-delivery/evidence/h01-observed-baseline.json",
    sha256: await fileDigest("documentation/implementation/2026-09-10-autonomous-delivery/evidence/h01-observed-baseline.json"),
  },
  next: status
    ? "Commit and revalidate before the independent owner ceremony."
    : "An independent owner process supplies issuer public keys, creates the root, pins its digest separately, and signs only claims it can prove.",
}, null, 2));

if (status) process.exitCode = 2;