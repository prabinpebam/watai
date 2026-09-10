import { createHash, createPublicKey, verify } from "node:crypto";

export type TrustedArtifactKind =
  | "actor-proof"
  | "authorization-grant"
  | "capability-attestation"
  | "credential-broker-attestation"
  | "dependency-receipt"
  | "deployment-observation"
  | "evidence-check"
  | "evidence-packet"
  | "guard-proof"
  | "impact-assessment"
  | "policy-candidate"
  | "release-permit"
  | "taskspec-lock"
  | "value-assessment"
  | "worker-isolation-attestation";

export interface TrustIssuer {
  issuerId: string;
  publicKeySpkiPem: string;
  allowedKinds: TrustedArtifactKind[];
  allowedRoles: string[];
}

export interface TrustRootManifest {
  schemaVersion: "1.0";
  status: "ACTIVE";
  rootId: string;
  repositoryId: string;
  epoch: number;
  validFrom: string;
  validUntil: string;
  backlogSha256: string;
  policySha256: string;
  workflowSha256: string;
  planSchemaSha256: string;
  controllerSha256: string;
  evaluatorPackSha256: string;
  testInventorySha256: string;
  fixtureManifestSha256: string;
  toolchainSha256: string;
  dependencyLockSha256: string;
  impactMapSha256: string;
  negativeControlIds: string[];
  issuers: TrustIssuer[];
  revokedArtifactIds: string[];
}

export interface SignedClaim<T = unknown> {
  schemaVersion: "1.0";
  kind: TrustedArtifactKind;
  artifactId: string;
  issuerId: string;
  issuedAt: string;
  expiresAt: string;
  payload: T;
  signatureBase64: string;
}

export interface TrustClock {
  now(): number;
}

export interface TrustVerification {
  valid: boolean;
  code:
    | "VERIFIED"
    | "ARTIFACT_EXPIRED"
    | "ARTIFACT_FUTURE"
    | "ARTIFACT_INVALID"
    | "ARTIFACT_REVOKED"
    | "ARTIFACT_TTL_EXCEEDED"
    | "ISSUER_FORBIDDEN"
    | "ISSUER_UNKNOWN"
    | "ROOT_DIGEST_MISMATCH"
    | "ROOT_EXPIRED"
    | "ROOT_INVALID"
    | "SIGNATURE_INVALID";
  message: string;
}

export interface TrustVerifierOptions {
  expectedRootSha256: string;
  maxClockSkewMs: number;
  maxArtifactLifetimeMs: number;
}

const digestPattern = /^[a-f0-9]{64}$/;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function trustRootSha256(root: TrustRootManifest): string {
  return sha256(canonical(root));
}

export function claimSigningBytes<T>(root: TrustRootManifest, claim: SignedClaim<T>): Buffer {
  return Buffer.from(`WATAI-HARNESS-CLAIM\0${canonical({
    rootId: root.rootId,
    rootEpoch: root.epoch,
    repositoryId: root.repositoryId,
    schemaVersion: claim.schemaVersion,
    kind: claim.kind,
    artifactId: claim.artifactId,
    issuerId: claim.issuerId,
    issuedAt: claim.issuedAt,
    expiresAt: claim.expiresAt,
    payload: claim.payload,
  })}`, "utf8");
}

function invalid(code: TrustVerification["code"], message: string): TrustVerification {
  return { valid: false, code, message };
}

export class TrustVerifier {
  readonly rootSha256: string;
  private readonly issuers = new Map<string, TrustIssuer>();
  private readonly revoked: Set<string>;

  constructor(
    readonly root: TrustRootManifest,
    private readonly clock: TrustClock,
    private readonly options: TrustVerifierOptions,
  ) {
    this.rootSha256 = trustRootSha256(root);
    this.revoked = new Set(root.revokedArtifactIds);
    for (const issuer of root.issuers) this.issuers.set(issuer.issuerId, issuer);
  }

  validateRoot(): TrustVerification {
    const now = this.clock.now();
    const rootFrom = Date.parse(this.root.validFrom);
    const rootUntil = Date.parse(this.root.validUntil);
    if (
      this.root.schemaVersion !== "1.0" ||
      this.root.status !== "ACTIVE" ||
      !this.root.rootId.trim() ||
      !this.root.repositoryId.trim() ||
      !Number.isSafeInteger(this.root.epoch) ||
      this.root.epoch < 1 ||
      !Number.isFinite(rootFrom) ||
      !Number.isFinite(rootUntil) ||
      rootFrom >= rootUntil ||
      ![
        this.root.backlogSha256,
        this.root.policySha256,
        this.root.workflowSha256,
        this.root.planSchemaSha256,
        this.root.controllerSha256,
        this.root.evaluatorPackSha256,
        this.root.testInventorySha256,
        this.root.fixtureManifestSha256,
        this.root.toolchainSha256,
        this.root.dependencyLockSha256,
        this.root.impactMapSha256,
      ].every(
        (value) => digestPattern.test(value),
      ) ||
      this.root.negativeControlIds.length === 0 ||
      this.root.negativeControlIds.some((id) => !id.trim()) ||
      new Set(this.root.negativeControlIds).size !== this.root.negativeControlIds.length ||
      this.root.issuers.some((issuer) =>
        issuer.allowedRoles.some((role) => !role.trim()) ||
        new Set(issuer.allowedRoles).size !== issuer.allowedRoles.length) ||
      this.issuers.size !== this.root.issuers.length
    ) {
      return invalid("ROOT_INVALID", "Trust root structure is invalid.");
    }
    if (this.rootSha256 !== this.options.expectedRootSha256) {
      return invalid("ROOT_DIGEST_MISMATCH", "Trust root does not match the externally pinned digest.");
    }
    if (!Number.isFinite(now) || now < rootFrom - this.options.maxClockSkewMs || now >= rootUntil) {
      return invalid("ROOT_EXPIRED", "Trust root is not current under the trusted clock.");
    }
    return { valid: true, code: "VERIFIED", message: "Trust root verified." };
  }

  verify<T>(claim: SignedClaim<T>): TrustVerification {
    const rootVerification = this.validateRoot();
    if (!rootVerification.valid) return rootVerification;
    const now = this.clock.now();
    if (
      claim.schemaVersion !== "1.0" ||
      !claim.artifactId.trim() ||
      !claim.issuerId.trim() ||
      !claim.signatureBase64.trim()
    ) {
      return invalid("ARTIFACT_INVALID", "Signed claim structure is invalid.");
    }
    if (claim.payload !== null && typeof claim.payload === "object" && !Array.isArray(claim.payload)) {
      const payload = claim.payload as Record<string, unknown>;
      if ("policySha256" in payload && payload.policySha256 !== this.root.policySha256) {
        return invalid("ARTIFACT_INVALID", "Claim policy binding does not match the active root.");
      }
      if ("repositoryId" in payload && payload.repositoryId !== this.root.repositoryId) {
        return invalid("ARTIFACT_INVALID", "Claim repository binding does not match the active root.");
      }
    }
    if (this.revoked.has(`${claim.kind}:${claim.artifactId}`)) {
      return invalid("ARTIFACT_REVOKED", "Signed claim has been revoked by the active root.");
    }
    const issuer = this.issuers.get(claim.issuerId);
    if (!issuer) return invalid("ISSUER_UNKNOWN", "Claim issuer is not trusted.");
    if (!issuer.allowedKinds.includes(claim.kind)) {
      return invalid("ISSUER_FORBIDDEN", "Claim issuer is not authorized for this artifact kind.");
    }
    if (claim.payload !== null && typeof claim.payload === "object" && !Array.isArray(claim.payload)) {
      const payload = claim.payload as Record<string, unknown>;
      const claimedRole = typeof payload.producerRole === "string"
        ? payload.producerRole
        : typeof payload.role === "string"
          ? payload.role
          : undefined;
      if (claimedRole && !issuer.allowedRoles.includes(claimedRole)) {
        return invalid("ISSUER_FORBIDDEN", "Claim issuer is not authorized for the asserted role.");
      }
    }
    const issuedAt = Date.parse(claim.issuedAt);
    const expiresAt = Date.parse(claim.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt >= expiresAt) {
      return invalid("ARTIFACT_INVALID", "Claim validity window is invalid.");
    }
    if (issuedAt > now + this.options.maxClockSkewMs) {
      return invalid("ARTIFACT_FUTURE", "Claim was issued in the future.");
    }
    if (expiresAt <= now) return invalid("ARTIFACT_EXPIRED", "Claim has expired.");
    if (expiresAt - issuedAt > this.options.maxArtifactLifetimeMs) {
      return invalid("ARTIFACT_TTL_EXCEEDED", "Claim lifetime exceeds the configured ceiling.");
    }

    try {
      const publicKey = createPublicKey(issuer.publicKeySpkiPem);
      const signature = Buffer.from(claim.signatureBase64, "base64");
      if (!verify(null, claimSigningBytes(this.root, claim), publicKey, signature)) {
        return invalid("SIGNATURE_INVALID", "Claim signature is invalid.");
      }
    } catch {
      return invalid("SIGNATURE_INVALID", "Claim signature or public key is malformed.");
    }
    return { valid: true, code: "VERIFIED", message: "Claim verified." };
  }
}

export interface PolicyFloor {
  schemaVersion: string;
  authorizationGranted: boolean;
  effectiveSpendUsd: number;
  mandatoryGates: string[];
  productMandatoryGates: string[];
  protectedPaths: string[];
  roles: Array<{
    id: string;
    canEditCandidate: boolean;
    canAttest: boolean;
    canRelease: boolean;
    canEditPolicy: boolean;
  }>;
  blockedPolicy: {
    humanFallback: boolean;
    weakenGates: boolean;
    inventPermissions: boolean;
    serveCandidate: boolean;
    rollbackRevokedRelease: boolean;
    missingEvidence: string;
    inconclusiveEvidence: string;
    requiredUnsupported: string;
  };
  limits: Record<string, number | number[]>;
}

export interface PolicyFloorResult {
  compatible: boolean;
  blockers: Array<{ code: string; message: string }>;
}

const nonIncreasingLimits = [
  "productWip",
  "builders",
  "promotions",
  "builderAttempts",
  "infrastructureReruns",
  "strategySwitches",
  "maxClockSkewSeconds",
  "permitTtlSeconds",
  "candidateActiveMinutes",
  "builderAttemptMinutes",
  "validationMinutes",
  "candidateUsd",
  "engineeringDayUsd",
  "evaluationRunUsd",
  "infraMonthUsd",
  "recoveryMonthUsd",
  "candidateInputTokens",
  "candidateOutputTokens",
] as const;

export function assessPolicyFloor(current: PolicyFloor, candidate: PolicyFloor): PolicyFloorResult {
  const blockers: PolicyFloorResult["blockers"] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  if (candidate.schemaVersion !== current.schemaVersion) {
    block("SCHEMA_CHANGED", "Policy schema changes require a separately versioned verifier.");
  }
  if (!current.authorizationGranted && candidate.authorizationGranted) {
    block("AUTHORITY_INCREASED", "A policy candidate cannot grant unattended authority to itself.");
  }
  if (candidate.effectiveSpendUsd > current.effectiveSpendUsd) {
    block("SPEND_INCREASED", "A policy candidate cannot increase its own effective spend.");
  }
  for (const gate of current.mandatoryGates) {
    if (!candidate.mandatoryGates.includes(gate)) block("MANDATORY_GATE_REMOVED", `${gate} was removed.`);
  }
  for (const gate of current.productMandatoryGates) {
    if (!candidate.productMandatoryGates.includes(gate)) block("PRODUCT_GATE_REMOVED", `${gate} was removed.`);
  }
  for (const path of current.protectedPaths) {
    if (!candidate.protectedPaths.includes(path)) block("PROTECTED_PATH_REMOVED", `${path} was removed.`);
  }

  const currentRoles = new Map(current.roles.map((role) => [role.id, role]));
  for (const role of candidate.roles) {
    const before = currentRoles.get(role.id);
    const permissions = ["canEditCandidate", "canAttest", "canRelease", "canEditPolicy"] as const;
    if (!before) {
      if (permissions.some((permission) => role[permission])) {
        block("PRIVILEGED_ROLE_ADDED", `New role ${role.id} contains authority.`);
      }
      continue;
    }
    for (const permission of permissions) {
      if (!before[permission] && role[permission]) {
        block("ROLE_AUTHORITY_INCREASED", `${role.id}.${permission} was enabled.`);
      }
    }
  }

  const fixedBlockedPolicy: Array<keyof PolicyFloor["blockedPolicy"]> = [
    "humanFallback",
    "weakenGates",
    "inventPermissions",
    "serveCandidate",
    "rollbackRevokedRelease",
    "missingEvidence",
    "inconclusiveEvidence",
    "requiredUnsupported",
  ];
  for (const key of fixedBlockedPolicy) {
    if (candidate.blockedPolicy[key] !== current.blockedPolicy[key]) {
      block("FAIL_CLOSED_POLICY_CHANGED", `blockedPolicy.${key} changed.`);
    }
  }
  for (const limit of nonIncreasingLimits) {
    const before = current.limits[limit];
    const after = candidate.limits[limit];
    if (typeof before === "number" && typeof after === "number" && after > before) {
      block("LIMIT_WIDENED", `${limit} increased from ${before} to ${after}.`);
    }
  }
  return { compatible: blockers.length === 0, blockers };
}