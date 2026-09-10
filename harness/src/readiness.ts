export type HarnessMode = "rehearsal" | "implementation" | "evaluation" | "release";

export type HarnessCapability =
  | "agent-provider"
  | "authorization-root"
  | "browser-runner"
  | "budget-reservation"
  | "candidate-worktree"
  | "credential-broker"
  | "controller-runtime"
  | "durable-ledger"
  | "effect-reconciler"
  | "execution-coordinator"
  | "evaluator-pack"
  | "guard-verifier"
  | "agent-model-evaluation"
  | "immutable-evidence"
  | "live-model-evaluator"
  | "release-broker"
  | "rollback-target"
  | "staged-environment"
  | "provider-usage"
  | "trusted-build"
  | "tool-gateway"
  | "watchdog"
  | "worker-isolation";

export interface HarnessPolicySummary {
  schemaVersion: string;
  status: string;
  authorizationGranted: boolean;
  effectiveSpendUsd: number;
}

export interface CapabilityAttestation {
  attestationId: string;
  capability: HarnessCapability;
  repositoryId: string;
  policySha256: string;
  evidenceSha256: string;
  workerIsolation?: {
    scope: "implementation-agent-smoke" | "candidate-validation";
    runtimeImageSha256: string;
  };
  modelEvaluation?: {
    evaluationId: string;
    manifestSha256: string;
    outcome: "PASSED";
    expectedRuns: number;
    attemptedRuns: number;
    providerId: string;
    requestedModel: string;
    observedModelVersions: string[];
    reportSha256: string;
    usage: {
      usd: number;
      inputTokens: number;
      outputTokens: number;
      requests: number;
      aiCredits: number;
    };
  };
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface RuntimeAuthorizationGrant {
  grantId: string;
  repositoryId: string;
  policySha256: string;
  modes: Array<"implementation" | "evaluation" | "release">;
  billing: {
    kind: "metered" | "subscription";
    maxUsd: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxRequests: number;
    maxAiCredits: number;
  };
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface ReadinessContext {
  repositoryId: string;
  authorizationGrant?: RuntimeAuthorizationGrant;
}

export interface ReadinessAuthorities {
  now(): number;
  verifyAuthorization(grant: RuntimeAuthorizationGrant): boolean;
  verifyCapability(attestation: CapabilityAttestation): boolean;
}

export interface ReadinessFinding {
  code: string;
  message: string;
}

export interface ReadinessResult {
  mode: HarnessMode;
  ready: boolean;
  blockers: ReadinessFinding[];
  warnings: ReadinessFinding[];
  verifiedCapabilities: HarnessCapability[];
}

const executionInfrastructureCapabilities: HarnessCapability[] = [
  "agent-provider",
  "authorization-root",
  "budget-reservation",
  "candidate-worktree",
  "credential-broker",
  "controller-runtime",
  "durable-ledger",
  "effect-reconciler",
  "execution-coordinator",
  "guard-verifier",
  "provider-usage",
  "tool-gateway",
  "watchdog",
  "worker-isolation",
];

const implementationCapabilities: HarnessCapability[] = [
  ...executionInfrastructureCapabilities,
  "agent-model-evaluation",
];

const evaluationCapabilities: HarnessCapability[] = [
  ...executionInfrastructureCapabilities,
  "browser-runner",
  "immutable-evidence",
  "live-model-evaluator",
  "evaluator-pack",
  "trusted-build",
];

const implementationAgentEvaluationCapabilities = new Set<HarnessCapability>([
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
]);

const releaseCapabilities: HarnessCapability[] = [
  ...evaluationCapabilities,
  "release-broker",
  "rollback-target",
  "staged-environment",
];

function validAttestation(
  attestation: CapabilityAttestation,
  policySha256: string,
  authorities: ReadinessAuthorities,
  repositoryId: string,
): boolean {
  const issuedAt = Date.parse(attestation.issuedAt);
  const expiresAt = Date.parse(attestation.expiresAt);
  const now = authorities.now();
  const digestPattern = /^[a-f0-9]{64}$/;
  const modelEvaluation = attestation.modelEvaluation;
  const workerIsolation = attestation.workerIsolation;
  const modelEvaluationValid = attestation.capability !== "agent-model-evaluation" || Boolean(
    modelEvaluation &&
    modelEvaluation.evaluationId === "implementation-agent-smoke" &&
    digestPattern.test(modelEvaluation.manifestSha256) &&
    modelEvaluation.outcome === "PASSED" &&
    Number.isSafeInteger(modelEvaluation.expectedRuns) && modelEvaluation.expectedRuns > 0 &&
    modelEvaluation.attemptedRuns === modelEvaluation.expectedRuns &&
    modelEvaluation.providerId.trim() &&
    modelEvaluation.requestedModel.trim() &&
    modelEvaluation.observedModelVersions.length > 0 &&
    modelEvaluation.observedModelVersions.every((version) => version.trim()) &&
    digestPattern.test(modelEvaluation.reportSha256) &&
    Number.isFinite(modelEvaluation.usage.usd) && modelEvaluation.usage.usd >= 0 &&
    Number.isSafeInteger(modelEvaluation.usage.inputTokens) && modelEvaluation.usage.inputTokens >= 0 &&
    Number.isSafeInteger(modelEvaluation.usage.outputTokens) && modelEvaluation.usage.outputTokens >= 0 &&
    Number.isSafeInteger(modelEvaluation.usage.requests) && modelEvaluation.usage.requests >= modelEvaluation.expectedRuns
    && Number.isFinite(modelEvaluation.usage.aiCredits) && modelEvaluation.usage.aiCredits >= 0
  );
  const workerIsolationValid = attestation.capability !== "worker-isolation" || Boolean(
    workerIsolation &&
    (workerIsolation.scope === "implementation-agent-smoke" || workerIsolation.scope === "candidate-validation") &&
    digestPattern.test(workerIsolation.runtimeImageSha256)
  );
  return (
    attestation.policySha256 === policySha256 &&
    attestation.repositoryId === repositoryId &&
    attestation.attestationId.trim().length > 0 &&
    digestPattern.test(attestation.evidenceSha256) &&
    modelEvaluationValid &&
    workerIsolationValid &&
    attestation.issuer.trim().length > 0 &&
    attestation.signature.trim().length > 0 &&
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    issuedAt <= now &&
    now < expiresAt &&
    issuedAt < expiresAt &&
    authorities.verifyCapability(attestation)
  );
}

function validAuthorization(
  grant: RuntimeAuthorizationGrant | undefined,
  policySha256: string,
  mode: Exclude<HarnessMode, "rehearsal">,
  context: ReadinessContext,
  authorities: ReadinessAuthorities,
): boolean {
  if (!grant) return false;
  const issuedAt = Date.parse(grant.issuedAt);
  const expiresAt = Date.parse(grant.expiresAt);
  const now = authorities.now();
  const billingValid =
    Number.isFinite(grant.billing.maxUsd) &&
    grant.billing.maxUsd >= 0 &&
    Number.isSafeInteger(grant.billing.maxInputTokens) &&
    grant.billing.maxInputTokens > 0 &&
    Number.isSafeInteger(grant.billing.maxOutputTokens) &&
    grant.billing.maxOutputTokens > 0 &&
    Number.isSafeInteger(grant.billing.maxRequests) &&
    grant.billing.maxRequests > 0 &&
    Number.isFinite(grant.billing.maxAiCredits) &&
    grant.billing.maxAiCredits > 0 &&
    (grant.billing.kind === "subscription" || grant.billing.maxUsd > 0);
  return (
    grant.repositoryId === context.repositoryId &&
    grant.policySha256 === policySha256 &&
    grant.modes.includes(mode) &&
    grant.grantId.trim().length > 0 &&
    grant.issuer.trim().length > 0 &&
    grant.signature.trim().length > 0 &&
    billingValid &&
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    issuedAt <= now &&
    now < expiresAt &&
    issuedAt < expiresAt &&
    authorities.verifyAuthorization(grant)
  );
}

export function assessReadiness(
  policy: HarnessPolicySummary,
  policySha256: string,
  mode: HarnessMode,
  attestations: CapabilityAttestation[],
  authorities: ReadinessAuthorities,
  context: ReadinessContext = { repositoryId: "unknown" },
): ReadinessResult {
  const blockers: ReadinessFinding[] = [];
  const warnings: ReadinessFinding[] = [];

  if (policy.schemaVersion !== "1.0" || policy.status !== "SPECIFIED") {
    blockers.push({
      code: "POLICY_UNSUPPORTED",
      message: `Unsupported policy ${policy.schemaVersion}/${policy.status}`,
    });
  }

  if (mode === "rehearsal") {
    warnings.push({
      code: "REHEARSAL_ONLY",
      message: "Synthetic authorities and in-memory state cannot authorize code, network, or release effects.",
    });
    return {
      mode,
      ready: blockers.length === 0,
      blockers,
      warnings,
      verifiedCapabilities: [],
    };
  }

  const externalAuthorization = validAuthorization(
    context.authorizationGrant,
    policySha256,
    mode,
    context,
    authorities,
  );
  if (!policy.authorizationGranted && !externalAuthorization) {
    blockers.push({
      code: "AUTHORIZATION_NOT_GRANTED",
      message: "No current independently signed runtime grant authorizes unattended mutation.",
    });
  }
  if (policy.authorizationGranted && policy.effectiveSpendUsd <= 0 && !externalAuthorization) {
    blockers.push({
      code: "SPEND_NOT_AUTHORIZED",
      message: "No metered or subscription-backed execution quota is authorized.",
    });
  }

  const required = mode === "release"
    ? releaseCapabilities
    : mode === "evaluation"
      ? evaluationCapabilities
      : implementationCapabilities;
  const verified = new Set<HarnessCapability>();
  for (const attestation of attestations) {
    if (
      validAttestation(attestation, policySha256, authorities, context.repositoryId) &&
      (attestation.capability !== "worker-isolation" || attestation.workerIsolation?.scope === "candidate-validation")
    ) {
      verified.add(attestation.capability);
    }
  }
  for (const capability of required) {
    if (!verified.has(capability)) {
      blockers.push({
        code: `CAPABILITY_MISSING:${capability}`,
        message: `No current trusted attestation proves ${capability}.`,
      });
    }
  }

  if (mode === "implementation") {
    warnings.push({
      code: "NO_RELEASE_AUTHORITY",
      message: "Implementation readiness does not authorize staging, routing, deployment, or promotion.",
    });
  }

  return {
    mode,
    ready: blockers.length === 0,
    blockers,
    warnings,
    verifiedCapabilities: [...verified].filter((capability) => required.includes(capability)),
  };
}

export function assessImplementationAgentEvaluationReadiness(
  policy: HarnessPolicySummary,
  policySha256: string,
  attestations: CapabilityAttestation[],
  authorities: ReadinessAuthorities,
  context: ReadinessContext,
  runtimeImageSha256: string,
): ReadinessResult {
  const full = assessReadiness(policy, policySha256, "evaluation", attestations, authorities, context);
  const blockers = full.blockers.filter((blocker) => {
    const capability = blocker.code.startsWith("CAPABILITY_MISSING:")
      ? blocker.code.slice("CAPABILITY_MISSING:".length) as HarnessCapability
      : undefined;
    return !capability || implementationAgentEvaluationCapabilities.has(capability);
  });
  const smokeIsolationReady = attestations.some((attestation) =>
    attestation.capability === "worker-isolation" &&
    attestation.workerIsolation?.scope === "implementation-agent-smoke" &&
    attestation.workerIsolation.runtimeImageSha256 === runtimeImageSha256 &&
    validAttestation(attestation, policySha256, authorities, context.repositoryId));
  const withoutCandidateIsolation = blockers.filter((blocker) => blocker.code !== "CAPABILITY_MISSING:worker-isolation");
  if (!smokeIsolationReady) {
    withoutCandidateIsolation.push({
      code: "CAPABILITY_MISSING:worker-isolation",
      message: "No current trusted attestation proves implementation-agent smoke worker isolation.",
    });
  }
  return {
    ...full,
    ready: withoutCandidateIsolation.length === 0,
    blockers: withoutCandidateIsolation,
    verifiedCapabilities: [
      ...full.verifiedCapabilities
        .filter((capability) => implementationAgentEvaluationCapabilities.has(capability)),
      ...(smokeIsolationReady ? ["worker-isolation" as const] : []),
    ],
  };
}