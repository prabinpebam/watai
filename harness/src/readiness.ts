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
  | "evaluator-pack"
  | "guard-verifier"
  | "immutable-evidence"
  | "release-broker"
  | "rollback-target"
  | "staged-environment"
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

const implementationCapabilities: HarnessCapability[] = [
  "agent-provider",
  "authorization-root",
  "budget-reservation",
  "candidate-worktree",
  "credential-broker",
  "controller-runtime",
  "durable-ledger",
  "effect-reconciler",
  "guard-verifier",
  "tool-gateway",
  "watchdog",
  "worker-isolation",
];

const evaluationCapabilities: HarnessCapability[] = [
  ...implementationCapabilities,
  "browser-runner",
  "immutable-evidence",
  "evaluator-pack",
  "trusted-build",
];

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
  return (
    attestation.policySha256 === policySha256 &&
    attestation.repositoryId === repositoryId &&
    attestation.attestationId.trim().length > 0 &&
    attestation.evidenceSha256.trim().length > 0 &&
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
    if (validAttestation(attestation, policySha256, authorities, context.repositoryId)) {
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