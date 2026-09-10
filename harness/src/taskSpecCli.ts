import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadOperationalAuthority } from "./operationalAuthority.js";
import { prepareTaskSpec, lockTaskSpec, type BacklogContract, type PrepareTaskInput } from "./taskSpec.js";
import type { ImpactMap } from "./evaluatorInventory.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestPath = process.env.WATAI_TASK_REQUEST_PATH?.trim();
if (!requestPath) throw new Error("WATAI_TASK_REQUEST_PATH is required.");
const request = JSON.parse(await readFile(resolve(requestPath), "utf8")) as Omit<
  PrepareTaskInput,
  "mode" | "bindings" | "capabilityAttestations" | "authorizationGrant" | "dependencyReceipts" | "impactAssessment" | "impactMap" | "preparedAt"
>;
const authority = await loadOperationalAuthority(root, "implementation");
const [backlog, impactMap] = await Promise.all([
  readFile(resolve(root, "documentation", "implementation", "2026-09-10-autonomous-delivery", "contracts", "backlog.json"), "utf8")
    .then((value) => JSON.parse(value) as BacklogContract),
  readFile(resolve(root, "harness", "evaluator", "impact-map.json"), "utf8")
    .then((value) => JSON.parse(value) as ImpactMap),
]);
const impacts = authority.bundle.impactAssessments.filter((assessment) =>
  assessment.sliceId === request.sliceId && assessment.sourceSha === request.source.sourceSha);
if (impacts.length !== 1) throw new Error(`Expected one current signed impact assessment, found ${impacts.length}.`);
const preparation = prepareTaskSpec(
  backlog,
  authority.policy,
  {
    ...request,
    mode: "implementation",
    bindings: authority.bundle.taskSpecBindings,
    capabilityAttestations: authority.bundle.capabilityAttestations,
    authorizationGrant: authority.grant,
    dependencyReceipts: authority.bundle.dependencyReceipts,
    impactAssessment: impacts[0],
    impactMap,
    preparedAt: new Date().toISOString(),
  },
  authority.authorities,
);
let output: typeof preparation.draft | ReturnType<typeof lockTaskSpec> = preparation.draft;
if (preparation.outcome === "READY_FOR_DISPATCH") {
  const locks = authority.bundle.taskSpecLocks.filter((proof) => proof.taskSpecSha256 === preparation.draft.taskSpecSha256);
  if (locks.length > 1) throw new Error("More than one TaskSpec lock targets this draft.");
  if (locks.length === 1) output = lockTaskSpec(preparation, locks[0], authority.policy, authority.authorities);
}
const outputPath = process.env.WATAI_TASK_OUTPUT_PATH?.trim();
if (outputPath) {
  const resolved = resolve(outputPath);
  await mkdir(dirname(resolved), { recursive: true, mode: 0o700 });
  await writeFile(resolved, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
console.log(JSON.stringify({
  schemaVersion: "1.0",
  outcome: preparation.outcome,
  blockers: preparation.blockers,
  warnings: preparation.warnings,
  task: output,
  outputPath: outputPath ? resolve(outputPath) : null,
  next: output.status === "SPEC_LOCKED"
    ? "The independently locked TaskSpec is ready for the durable executor."
    : "Have the external TaskSpec issuer sign this exact taskSpecSha256, add the claim to the authority bundle, and rerun.",
}, null, 2));
if (preparation.outcome !== "READY_FOR_DISPATCH") process.exitCode = 2;
