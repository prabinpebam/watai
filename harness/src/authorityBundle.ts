import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type {
  CapabilityAttestation,
  RuntimeAuthorizationGrant,
} from "./readiness.js";
import type { AuthorityBindings, DependencyReceipt, ImpactAssessment, TaskSpecLockProof } from "./taskSpec.js";
import type { CredentialBrokerAttestation, WorkerIsolationAttestation } from "./worker.js";
import type { DeploymentObservation } from "./preflight.js";
import type { ValueAssessment } from "./scheduler.js";
import type { ProviderUsageReceipt } from "./executionCoordinator.js";
import type { LiveModelRunObservation } from "./modelEvaluation.js";
import {
  TrustVerifier,
  type SignedClaim,
  type TrustClock,
  type TrustRootManifest,
  type TrustVerification,
} from "./trust.js";

export interface AuthorityBundleExpectations {
  expectedRootSha256: string;
  repositoryId: string;
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
  maxClockSkewMs: number;
  maxClaimLifetimeMs: number;
}

export interface LoadedAuthorityBundle {
  authorityDirectory: string;
  root: TrustRootManifest;
  verifier: TrustVerifier;
  validClaims: SignedClaim[];
  rejectedClaims: Array<{
    file: string;
    artifactId: string;
    verification: TrustVerification;
  }>;
  authorizationGrants: RuntimeAuthorizationGrant[];
  capabilityAttestations: CapabilityAttestation[];
  dependencyReceipts: DependencyReceipt[];
  impactAssessments: ImpactAssessment[];
  taskSpecLocks: TaskSpecLockProof[];
  workerIsolationAttestations: WorkerIsolationAttestation[];
  credentialBrokerAttestations: CredentialBrokerAttestation[];
  deploymentObservations: Array<DeploymentObservation & {
    observationId: string;
    repositoryId: string;
    policySha256: string;
    observedAt: string;
  }>;
  taskSpecBindings: AuthorityBindings;
  valueAssessments: ValueAssessment[];
  providerUsageReceipts: ProviderUsageReceipt[];
  modelEvaluationObservations: LiveModelRunObservation[];
}

export class AuthorityBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AuthorityBundleError";
  }
}

function insideRepository(repositoryRoot: string, target: string): boolean {
  const path = relative(resolve(repositoryRoot), resolve(target));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AuthorityBundleError("AUTHORITY_JSON_INVALID", `${label} is not valid JSON.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function materialize<T>(claim: SignedClaim): T {
  if (!isRecord(claim.payload)) {
    throw new AuthorityBundleError("AUTHORITY_CLAIM_INVALID", `${claim.artifactId} payload must be an object.`);
  }
  return {
    ...claim.payload,
    issuer: claim.issuerId,
    issuedAt: claim.issuedAt,
    expiresAt: claim.expiresAt,
    signature: claim.signatureBase64,
  } as T;
}

export async function loadAuthorityBundle(
  repositoryRoot: string,
  authorityDirectory: string,
  clock: TrustClock,
  expected: AuthorityBundleExpectations,
): Promise<LoadedAuthorityBundle> {
  if (!/^[a-f0-9]{64}$/.test(expected.expectedRootSha256)) {
    throw new AuthorityBundleError(
      "ROOT_PIN_MISSING",
      "A separately configured lowercase SHA-256 root pin is required.",
    );
  }
  const repository = await realpath(repositoryRoot);
  const directory = await realpath(authorityDirectory);
  if (insideRepository(repository, directory)) {
    throw new AuthorityBundleError(
      "AUTHORITY_INSIDE_REPOSITORY",
      "Authority material must be outside every candidate-writable repository path.",
    );
  }
  const rootPath = await realpath(resolve(directory, "trust-root.json"));
  if (!insideRepository(directory, rootPath) || insideRepository(repository, rootPath)) {
    throw new AuthorityBundleError("AUTHORITY_PATH_ESCAPE", "Trust root escapes its external authority directory.");
  }
  const rootText = await readFile(rootPath, "utf8");
  const root = parseJson<TrustRootManifest>(rootText, rootPath);
  const verifier = new TrustVerifier(root, clock, {
    expectedRootSha256: expected.expectedRootSha256,
    maxClockSkewMs: expected.maxClockSkewMs,
    maxArtifactLifetimeMs: expected.maxClaimLifetimeMs,
  });
  const rootVerification = verifier.validateRoot();
  if (!rootVerification.valid) {
    throw new AuthorityBundleError(rootVerification.code, rootVerification.message);
  }
  if (root.repositoryId !== expected.repositoryId) {
    throw new AuthorityBundleError("ROOT_REPOSITORY_MISMATCH", "Trust root is for another repository.");
  }
  if (
    root.backlogSha256 !== expected.backlogSha256 ||
    root.policySha256 !== expected.policySha256 ||
    root.workflowSha256 !== expected.workflowSha256 ||
    root.planSchemaSha256 !== expected.planSchemaSha256 ||
    root.controllerSha256 !== expected.controllerSha256 ||
    root.evaluatorPackSha256 !== expected.evaluatorPackSha256 ||
    root.testInventorySha256 !== expected.testInventorySha256 ||
    root.fixtureManifestSha256 !== expected.fixtureManifestSha256 ||
    root.toolchainSha256 !== expected.toolchainSha256 ||
    root.dependencyLockSha256 !== expected.dependencyLockSha256 ||
    root.impactMapSha256 !== expected.impactMapSha256 ||
    JSON.stringify(root.negativeControlIds) !== JSON.stringify(expected.negativeControlIds)
  ) {
    throw new AuthorityBundleError(
      "ROOT_CONTRACT_MISMATCH",
      "Trust root pins different backlog, policy, workflow, schema, controller or dependency bytes.",
    );
  }

  const claimsDirectory = await realpath(resolve(directory, "claims"));
  if (!insideRepository(directory, claimsDirectory) || insideRepository(repository, claimsDirectory)) {
    throw new AuthorityBundleError("AUTHORITY_PATH_ESCAPE", "Claims directory escapes external authority.");
  }
  const files = (await readdir(claimsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const validClaims: SignedClaim[] = [];
  const rejectedClaims: LoadedAuthorityBundle["rejectedClaims"] = [];
  const identities = new Set<string>();
  for (const file of files) {
    const claimPath = await realpath(resolve(claimsDirectory, file));
    if (!insideRepository(claimsDirectory, claimPath) || insideRepository(repository, claimPath)) {
      throw new AuthorityBundleError("AUTHORITY_PATH_ESCAPE", `${file} resolves outside the claims directory.`);
    }
    const claim = parseJson<SignedClaim>(
      await readFile(claimPath, "utf8"),
      file,
    );
    const identity = `${claim.kind}:${claim.artifactId}`;
    if (identities.has(identity)) {
      throw new AuthorityBundleError("AUTHORITY_CLAIM_DUPLICATE", `Duplicate signed artifact ${identity}.`);
    }
    identities.add(identity);
    const verification = verifier.verify(claim);
    if (verification.valid) validClaims.push(claim);
    else rejectedClaims.push({ file, artifactId: claim.artifactId, verification });
  }

  return {
    authorityDirectory: directory,
    root,
    verifier,
    validClaims,
    rejectedClaims,
    authorizationGrants: validClaims
      .filter((claim) => claim.kind === "authorization-grant")
      .map((claim) => materialize<RuntimeAuthorizationGrant>(claim)),
    capabilityAttestations: validClaims
      .filter((claim) => claim.kind === "capability-attestation")
      .map((claim) => materialize<CapabilityAttestation>(claim)),
    dependencyReceipts: validClaims
      .filter((claim) => claim.kind === "dependency-receipt")
      .map((claim) => materialize<DependencyReceipt>(claim)),
    impactAssessments: validClaims
      .filter((claim) => claim.kind === "impact-assessment")
      .map((claim) => materialize<ImpactAssessment>(claim)),
    taskSpecLocks: validClaims
      .filter((claim) => claim.kind === "taskspec-lock")
      .map((claim) => materialize<TaskSpecLockProof>(claim)),
    workerIsolationAttestations: validClaims
      .filter((claim) => claim.kind === "worker-isolation-attestation")
      .map((claim) => materialize<WorkerIsolationAttestation>(claim)),
    credentialBrokerAttestations: validClaims
      .filter((claim) => claim.kind === "credential-broker-attestation")
      .map((claim) => materialize<CredentialBrokerAttestation>(claim)),
    deploymentObservations: validClaims
      .filter((claim) => claim.kind === "deployment-observation")
      .map((claim) => materialize<DeploymentObservation & {
        observationId: string;
        repositoryId: string;
        policySha256: string;
        observedAt: string;
      }>(claim)),
    valueAssessments: validClaims
      .filter((claim) => claim.kind === "value-assessment")
      .map((claim) => materialize<ValueAssessment>(claim)),
    providerUsageReceipts: validClaims
      .filter((claim) => claim.kind === "provider-usage-receipt")
      .map((claim) => materialize<ProviderUsageReceipt>(claim)),
    modelEvaluationObservations: validClaims
      .filter((claim) => claim.kind === "model-evaluation-observation")
      .map((claim) => materialize<LiveModelRunObservation>(claim)),
    taskSpecBindings: {
      backlogSha256: root.backlogSha256,
      policySha256: root.policySha256,
      workflowSha256: root.workflowSha256,
      planSchemaSha256: root.planSchemaSha256,
      controllerSha256: root.controllerSha256,
      evaluatorPackSha256: root.evaluatorPackSha256,
      testInventorySha256: root.testInventorySha256,
      fixtureManifestSha256: root.fixtureManifestSha256,
      toolchainSha256: root.toolchainSha256,
      dependencyLockSha256: root.dependencyLockSha256,
      impactMapSha256: root.impactMapSha256,
      negativeControlIds: [...root.negativeControlIds],
    },
  };
}