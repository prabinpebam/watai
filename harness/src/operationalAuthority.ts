import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadAuthorityBundle, type LoadedAuthorityBundle } from "./authorityBundle.js";
import { collectAuthorityContractDigests } from "./authorityInputs.js";
import {
  assessReadiness,
  type HarnessMode,
  type ReadinessResult,
  type RuntimeAuthorizationGrant,
} from "./readiness.js";
import type { ExecutionPolicy } from "./taskSpec.js";
import { TrustBackedAuthorities } from "./trustAuthorities.js";
import {
  admitLiveModelEvaluation,
  type LiveModelEvaluationManifest,
} from "./modelEvaluation.js";
import { canonical, sha256 } from "./trust.js";

export interface OperationalAuthorityContext {
  policy: ExecutionPolicy & {
    limits: ExecutionPolicy["limits"] & {
      workerLeaseSeconds: number;
      workerHeartbeatSeconds: number;
      minimumEffectLeaseSeconds: number;
      validationMinutes: number;
      evaluationRunUsd: number;
    };
  };
  policySha256: string;
  repositoryId: string;
  bundle: LoadedAuthorityBundle;
  authorities: TrustBackedAuthorities;
  grant: RuntimeAuthorizationGrant;
  readiness: ReadinessResult;
}

export type TrustedAuthorityContext = Omit<OperationalAuthorityContext, "grant" | "readiness">;

export async function loadTrustedAuthority(
  root: string,
): Promise<TrustedAuthorityContext> {
  const authorityDirectory = process.env.WATAI_HARNESS_AUTHORITY_DIR?.trim();
  const rootPin = process.env.WATAI_HARNESS_ROOT_SHA256?.trim();
  if (!authorityDirectory || !rootPin) throw new Error("External authority directory and separately pinned root digest are required.");
  const contracts = resolve(root, "documentation", "implementation", "2026-09-10-autonomous-delivery", "contracts");
  const [policyText, digests] = await Promise.all([
    readFile(resolve(contracts, "policy.json"), "utf8"),
    collectAuthorityContractDigests(root),
  ]);
  const policy = JSON.parse(policyText) as OperationalAuthorityContext["policy"];
  const policySha256 = digests.policySha256;
  const repositoryId = process.env.WATAI_REPOSITORY_ID?.trim() || "prabinpebam/watai";
  const clock = { now: () => Date.now() };
  const bundle = await loadAuthorityBundle(root, authorityDirectory, clock, {
    expectedRootSha256: rootPin,
    repositoryId,
    ...digests,
    maxClockSkewMs: policy.limits.maxClockSkewSeconds * 1_000,
    maxClaimLifetimeMs: 24 * 60 * 60_000,
  });
  if (bundle.rejectedClaims.length > 0) throw new Error(`${bundle.rejectedClaims.length} authority claim(s) were rejected.`);
  const authorities = new TrustBackedAuthorities(bundle.verifier, clock, {
    maxClockSkewMs: policy.limits.maxClockSkewSeconds * 1_000,
    maxGuardProofLifetimeMs: policy.limits.permitTtlSeconds * 1_000,
    maxPermitLifetimeMs: policy.limits.permitTtlSeconds * 1_000,
    maxEffectLifetimeMs: policy.limits.validationMinutes * 60_000,
  });
  return { policy, policySha256, repositoryId, bundle, authorities };
}

export async function loadOperationalAuthority(
  root: string,
  mode: Exclude<HarnessMode, "rehearsal">,
): Promise<OperationalAuthorityContext> {
  const trusted = await loadTrustedAuthority(root);
  const grant = trusted.bundle.authorizationGrants.find((candidate) => candidate.modes.includes(mode));
  if (!grant) throw new Error(`No current signed ${mode} grant exists.`);
  const readiness = assessReadiness(trusted.policy, trusted.policySha256, mode, trusted.bundle.capabilityAttestations, trusted.authorities, {
    repositoryId: trusted.repositoryId,
    authorizationGrant: grant,
  });
  if (!readiness.ready) throw new Error(`${mode} authority is blocked: ${readiness.blockers.map((blocker) => blocker.code).join(", ")}`);
  if (mode === "implementation") {
    const manifest = JSON.parse(
      await readFile(resolve(root, "harness", "evaluator", "model-evaluations.json"), "utf8"),
    ) as LiveModelEvaluationManifest;
    const contract = manifest.evaluations.find((evaluation) => evaluation.id === "implementation-agent-smoke");
    if (!contract) throw new Error("Frozen implementation-agent evaluation contract is missing.");
    const observations = trusted.bundle.modelEvaluationObservations
      .filter((observation) => observation.evaluationId === contract.id);
    const admission = admitLiveModelEvaluation(contract, observations, trusted.authorities);
    if (admission.outcome !== "PASSED") {
      throw new Error(`Implementation-agent evidence failed admission: ${admission.blockers.map((blocker) => blocker.code).join(", ")}`);
    }
    const capability = trusted.bundle.capabilityAttestations
      .find((attestation) => attestation.capability === "agent-model-evaluation");
    const summary = capability?.modelEvaluation;
    const manifestSha256 = sha256(canonical(manifest));
    const reportSha256 = sha256(canonical(observations));
    const observedVersions = [...new Set(observations.map((observation) => observation.resolvedModelVersion)
      .filter((version): version is string => Boolean(version)))].sort();
    if (
      !summary ||
      summary.evaluationId !== contract.id ||
      summary.manifestSha256 !== manifestSha256 ||
      summary.outcome !== "PASSED" ||
      summary.expectedRuns !== admission.expectedRuns ||
      summary.attemptedRuns !== admission.attemptedRuns ||
      summary.providerId !== contract.providerId ||
      summary.requestedModel !== contract.requestedModel ||
      canonical([...summary.observedModelVersions].sort()) !== canonical(observedVersions) ||
      summary.reportSha256 !== reportSha256 ||
      canonical(summary.usage) !== canonical(admission.totalUsage)
    ) {
      throw new Error("Agent-model capability summary does not match the admitted signed observation set.");
    }
  }
  return { ...trusted, grant, readiness };
}
