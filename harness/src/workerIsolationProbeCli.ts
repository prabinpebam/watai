import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CommandArtifactSigner } from "./externalSigner.js";
import { verifyLockedTaskSpec, type LockedTaskSpec } from "./taskSpec.js";
import type { WorkerRuntimePlan } from "./worker.js";
import { probeWorkerIsolation } from "./workerIsolationProbe.js";
import { loadTrustedAuthority } from "./operationalAuthority.js";
import { canonical } from "./trust.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function signerArgs(): string[] {
  const value = process.env.WATAI_EVIDENCE_SIGNER_ARGS_JSON?.trim();
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("WATAI_EVIDENCE_SIGNER_ARGS_JSON must be a JSON string array.");
  }
  return parsed;
}

const [task, runtime] = await Promise.all([
  readFile(resolve(required("WATAI_TASK_SPEC_PATH")), "utf8").then((value) => JSON.parse(value) as LockedTaskSpec),
  readFile(resolve(required("WATAI_WORKER_RUNTIME_PATH")), "utf8").then((value) => JSON.parse(value) as WorkerRuntimePlan),
]);
const authority = await loadTrustedAuthority(root);
if (
  !verifyLockedTaskSpec(task, authority.policy, authority.authorities) ||
  canonical(task.bindings) !== canonical(authority.bundle.taskSpecBindings) ||
  !task.agentRuntime ||
  task.agentRuntime.providerId !== runtime.providerId ||
  task.agentRuntime.model !== runtime.model
) {
  throw new Error("Worker probe inputs are not bound to one locked TaskSpec runtime.");
}
const result = probeWorkerIsolation(task, runtime, resolve(required("WATAI_PROBE_SOURCE_ROOT")));
let signedAttestation;
if (result.status === "PASSED" && result.attestationPayload && process.env.WATAI_EVIDENCE_SIGNER_EXECUTABLE?.trim()) {
  const signer = new CommandArtifactSigner({
    executable: process.env.WATAI_EVIDENCE_SIGNER_EXECUTABLE.trim(),
    args: signerArgs(),
    cwd: process.env.WATAI_EVIDENCE_SIGNER_CWD?.trim() || root,
    timeoutMs: 30_000,
  });
  signedAttestation = await signer.signWorkerIsolation(result.attestationPayload);
}
console.log(JSON.stringify({
  schemaVersion: "1.0",
  releaseEligible: false,
  ...result,
  signedAttestation: signedAttestation ?? null,
  next: signedAttestation
    ? "Place the signed claim in the external authority bundle and regenerate readiness."
    : "Have an independent external signer sign the passing task-bound attestation payload.",
}, null, 2));
if (result.status !== "PASSED" || !signedAttestation) process.exitCode = 2;
