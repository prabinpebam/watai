import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAuthorityBundle } from "./authorityBundle.js";
import { compiledRuntimeSha256 } from "./authorityInputs.js";
import { buildDoctorReport } from "./doctor.js";
import { collectLocalPreflight } from "./preflight.js";
import { assessReadiness, type ReadinessAuthorities, type RuntimeAuthorizationGrant } from "./readiness.js";
import { selectNextSlice } from "./scheduler.js";
import type { BacklogContract, ExecutionPolicy } from "./taskSpec.js";
import { TrustBackedAuthorities } from "./trustAuthorities.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contracts = resolve(root, "documentation", "implementation", "2026-09-10-autonomous-delivery", "contracts");
const [policyText, workflowText, backlogText, schemaText, controllerSha256, rootLock, apiLock, localPreflight] = await Promise.all([
  readFile(resolve(contracts, "policy.json"), "utf8"),
  readFile(resolve(contracts, "workflow.json"), "utf8"),
  readFile(resolve(contracts, "backlog.json"), "utf8"),
  readFile(resolve(contracts, "plan.schema.json"), "utf8"),
  compiledRuntimeSha256(root),
  readFile(resolve(root, "package-lock.json")),
  readFile(resolve(root, "api", "package-lock.json")),
  collectLocalPreflight(root),
]);
const policy = JSON.parse(policyText) as ExecutionPolicy & {
  limits: ExecutionPolicy["limits"] & {
    maxClockSkewSeconds: number;
    permitTtlSeconds: number;
    validationMinutes: number;
  };
};
const backlog = JSON.parse(backlogText) as BacklogContract;
const policySha256 = createHash("sha256").update(policyText).digest("hex");
const workflowSha256 = createHash("sha256").update(workflowText).digest("hex");
const backlogSha256 = createHash("sha256").update(backlogText).digest("hex");
const planSchemaSha256 = createHash("sha256").update(schemaText).digest("hex");
const dependencyLockSha256 = createHash("sha256")
  .update(rootLock)
  .update("\0")
  .update(apiLock)
  .digest("hex");
const repositoryId = process.env.WATAI_REPOSITORY_ID ?? localPreflight.repository.repositoryId;
const clock = { now: () => Date.now() };
let authorities: ReadinessAuthorities = {
  now: clock.now,
  verifyAuthorization: () => false,
  verifyCapability: () => false,
};
let grants: RuntimeAuthorizationGrant[] = [];
let capabilities = [] as Awaited<ReturnType<typeof loadAuthorityBundle>>["capabilityAttestations"];
let completions = [] as Awaited<ReturnType<typeof loadAuthorityBundle>>["dependencyReceipts"];
let valueAssessments = [] as Awaited<ReturnType<typeof loadAuthorityBundle>>["valueAssessments"];
let authorityError: { code: string; message: string } | undefined;
let preflight = localPreflight;
const authorityDirectory = process.env.WATAI_HARNESS_AUTHORITY_DIR;
if (authorityDirectory) {
  try {
    const bundle = await loadAuthorityBundle(root, authorityDirectory, clock, {
      expectedRootSha256: process.env.WATAI_HARNESS_ROOT_SHA256 ?? "",
      repositoryId,
      backlogSha256,
      policySha256,
      workflowSha256,
      planSchemaSha256,
      controllerSha256,
      dependencyLockSha256,
      maxClockSkewMs: policy.limits.maxClockSkewSeconds * 1_000,
      maxClaimLifetimeMs: 24 * 60 * 60_000,
    });
    authorities = new TrustBackedAuthorities(bundle.verifier, clock, {
      maxClockSkewMs: policy.limits.maxClockSkewSeconds * 1_000,
      maxGuardProofLifetimeMs: policy.limits.permitTtlSeconds * 1_000,
      maxPermitLifetimeMs: policy.limits.permitTtlSeconds * 1_000,
      maxEffectLifetimeMs: policy.limits.validationMinutes * 60_000,
    });
    grants = bundle.authorizationGrants;
    capabilities = bundle.capabilityAttestations;
    completions = bundle.dependencyReceipts;
    valueAssessments = bundle.valueAssessments;
    if (bundle.deploymentObservations.length === 1) {
      const observation = bundle.deploymentObservations[0];
      preflight = await collectLocalPreflight(root, {
        sourceSha: observation.sourceSha,
        frontendArtifactSha256: observation.frontendArtifactSha256,
        apiArtifactSha256: observation.apiArtifactSha256,
        runtime: observation.runtime,
        region: observation.region,
        configRevision: observation.configRevision,
        infraRevision: observation.infraRevision,
        dataSchemaRevision: observation.dataSchemaRevision,
        queueGeneration: observation.queueGeneration,
        reason: observation.reason,
      });
    } else if (bundle.deploymentObservations.length > 1) {
      authorityError = {
        code: "DEPLOYMENT_OBSERVATION_AMBIGUOUS",
        message: "More than one current signed deployment observation was supplied.",
      };
    }
    if (bundle.rejectedClaims.length > 0) {
      authorityError = { code: "AUTHORITY_CLAIMS_REJECTED", message: `${bundle.rejectedClaims.length} claim(s) rejected.` };
    }
  } catch (error) {
    authorityError = {
      code: (error as { code?: string }).code ?? "AUTHORITY_BUNDLE_INVALID",
      message: error instanceof Error ? error.message : "Authority bundle failed.",
    };
  }
}
const forMode = (mode: "implementation" | "evaluation" | "release") => assessReadiness(
  policy,
  policySha256,
  mode,
  capabilities,
  authorities,
  { repositoryId, authorizationGrant: grants.find((grant) => grant.modes.includes(mode)) },
);
const report = buildDoctorReport({
  generatedAt: new Date().toISOString(),
  preflight,
  implementation: forMode("implementation"),
  evaluation: forMode("evaluation"),
  release: forMode("release"),
  schedule: selectNextSlice(
    backlog,
    policy,
    completions.map((receipt) => ({
      sliceId: receipt.sliceId,
      status: receipt.status,
      receiptSha256: receipt.receiptSha256,
      verified: true,
    })),
    [],
    valueAssessments,
  ),
  authorityError,
});
const outputPath = resolve(root, ".harness-state", "dod-readiness.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ ...report, outputPath }, null, 2));