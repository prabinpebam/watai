import type { AuthorityContractDigests } from "./authorityInputs.js";
import type { HarnessCapability } from "./readiness.js";
import { canonical, sha256, type TrustedArtifactKind } from "./trust.js";

export const implementationAgentBootstrapCapabilities: HarnessCapability[] = [
  "agent-provider",
  "authorization-root",
  "budget-reservation",
  "credential-broker",
  "durable-ledger",
  "evaluator-pack",
  "live-model-evaluator",
  "provider-usage",
  "tool-gateway",
  "trusted-build",
  "worker-isolation",
];

export interface AuthorityCeremonyEvidence {
  sourceSha: string;
  rootInputs: AuthorityContractDigests;
  smokeWorkerImageSha256: string;
  smokeWorkerProbeSha256: string;
  candidateWorkerImageSha256: string;
  candidateWorkerProbeSha256: string;
  validationOutputSha256: string;
  npmRegistry: string;
  gitHubCliAuthenticated: boolean;
  dockerServerVersion: string;
}

export interface UnsignedClaimRequest {
  kind: "authorization-grant" | "capability-attestation";
  artifactId: string;
  payload: Record<string, unknown>;
  maximumLifetimeSeconds: number;
}

export interface AuthorityCeremonyRequest {
  schemaVersion: "1.0";
  status: "READY_FOR_INDEPENDENT_REVIEW";
  releaseEligible: false;
  attemptId: string;
  evaluationStage: "canary" | "qualification";
  repositoryId: string;
  sourceSha: string;
  rootFixedFields: AuthorityContractDigests;
  requiredIssuers: Array<{
    purpose: "owner-authority" | "runtime-evidence";
    allowedKinds: TrustedArtifactKind[];
    allowedRoles: string[];
  }>;
  evidence: AuthorityCeremonyEvidence;
  evidenceSha256: string;
  unsignedClaimRequests: UnsignedClaimRequest[];
  instructions: string[];
}

export function buildAuthorityCeremonyRequest(input: {
  attemptId: string;
  evaluationStage: "canary" | "qualification";
  repositoryId: string;
  evidence: AuthorityCeremonyEvidence;
  evaluationBudget: {
    usd: number;
    inputTokens: number;
    outputTokens: number;
    requests: number;
  };
  maxAiCredits: number;
  claimLifetimeSeconds: number;
}): AuthorityCeremonyRequest {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,80}$/.test(input.attemptId)) {
    throw new Error("Authority ceremony attempt ID is invalid.");
  }
  const evidenceSha256 = sha256(canonical(input.evidence));
  const prefix = `${input.evidence.sourceSha.slice(0, 12)}-${input.attemptId}`;
  const capabilityRequests: UnsignedClaimRequest[] = implementationAgentBootstrapCapabilities.map((capability) => ({
    kind: "capability-attestation",
    artifactId: `bootstrap-${prefix}-${capability}`,
    maximumLifetimeSeconds: input.claimLifetimeSeconds,
    payload: {
      attestationId: `bootstrap-${prefix}-${capability}`,
      capability,
      repositoryId: input.repositoryId,
      policySha256: input.evidence.rootInputs.policySha256,
      evidenceSha256: sha256(canonical({ capability, evidenceSha256 })),
      ...(capability === "worker-isolation" ? {
        workerIsolation: {
          scope: "implementation-agent-smoke",
          runtimeImageSha256: input.evidence.smokeWorkerImageSha256,
        },
      } : {}),
    },
  }));
  capabilityRequests.push({
    kind: "capability-attestation",
    artifactId: `bootstrap-${prefix}-candidate-worker-isolation`,
    maximumLifetimeSeconds: input.claimLifetimeSeconds,
    payload: {
      attestationId: `bootstrap-${prefix}-candidate-worker-isolation`,
      capability: "worker-isolation",
      repositoryId: input.repositoryId,
      policySha256: input.evidence.rootInputs.policySha256,
      evidenceSha256: sha256(canonical({
        capability: "worker-isolation",
        scope: "candidate-validation",
        evidenceSha256,
      })),
      workerIsolation: {
        scope: "candidate-validation",
        runtimeImageSha256: input.evidence.candidateWorkerImageSha256,
      },
    },
  });
  return {
    schemaVersion: "1.0",
    status: "READY_FOR_INDEPENDENT_REVIEW",
    releaseEligible: false,
    attemptId: input.attemptId,
    evaluationStage: input.evaluationStage,
    repositoryId: input.repositoryId,
    sourceSha: input.evidence.sourceSha,
    rootFixedFields: input.evidence.rootInputs,
    requiredIssuers: [
      {
        purpose: "owner-authority",
        allowedKinds: [
          "authorization-grant",
          "capability-attestation",
          "credential-broker-attestation",
          "deployment-observation",
          "impact-assessment",
          "taskspec-lock",
          "worker-isolation-attestation",
        ],
        allowedRoles: [],
      },
      {
        purpose: "runtime-evidence",
        allowedKinds: ["model-evaluation-observation", "provider-usage-receipt", "worker-isolation-attestation"],
        allowedRoles: [],
      },
    ],
    evidence: input.evidence,
    evidenceSha256,
    unsignedClaimRequests: [
      {
        kind: "authorization-grant",
        artifactId: `bootstrap-${prefix}-${input.evaluationStage}-evaluation-grant`,
        maximumLifetimeSeconds: input.claimLifetimeSeconds,
        payload: {
          grantId: `bootstrap-${prefix}-${input.evaluationStage}-evaluation-grant`,
          repositoryId: input.repositoryId,
          policySha256: input.evidence.rootInputs.policySha256,
          modes: ["evaluation"],
          billing: {
            kind: "subscription",
            maxUsd: input.evaluationBudget.usd,
            maxInputTokens: input.evaluationBudget.inputTokens,
            maxOutputTokens: input.evaluationBudget.outputTokens,
            maxRequests: input.evaluationBudget.requests,
            maxAiCredits: input.maxAiCredits,
          },
        },
      },
      ...capabilityRequests,
    ],
    instructions: [
      "Independently verify the source, root bindings, image digest, isolation probe and validation output.",
      "Create an external trust-root.json with independent issuer public keys and the exact rootFixedFields.",
      "Construct and sign only approved claim requests with claimSigningBytes(); do not copy placeholder signatures.",
      "Pin the canonical trust-root SHA-256 separately from the authority directory.",
      "Keep private keys and signer credentials outside the repository, model context and candidate worktrees.",
    ],
  };
}