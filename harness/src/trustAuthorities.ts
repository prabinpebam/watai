import type {
  ActorProof,
  GuardProof,
  HarnessAuthorities,
  ReleasePermit,
} from "./controller.js";
import type {
  CapabilityAttestation,
  ReadinessAuthorities,
  RuntimeAuthorizationGrant,
} from "./readiness.js";
import type {
  DependencyReceipt,
  ImpactAssessment,
  TaskSpecAuthorities,
  TaskSpecLockProof,
} from "./taskSpec.js";
import { TrustVerifier, type SignedClaim, type TrustedArtifactKind } from "./trust.js";
import type {
  CredentialBrokerAttestation,
  WorkerAuthorities,
  WorkerIsolationAttestation,
} from "./worker.js";
import type { ExecutionCoordinatorAuthorities, ProviderUsageReceipt } from "./executionCoordinator.js";
import type { LiveModelEvaluationAuthorities, LiveModelRunObservation } from "./modelEvaluation.js";
import type { CandidateEvidencePacket, EvidenceAuthorities, EvidenceCheck } from "./evidence.js";

type TrustLimits = HarnessAuthorities["limits"];

function claim<T>(
  kind: TrustedArtifactKind,
  artifactId: string,
  issuerId: string,
  issuedAt: string,
  expiresAt: string,
  payload: T,
  signatureBase64: string,
): SignedClaim<T> {
  return {
    schemaVersion: "1.0",
    kind,
    artifactId,
    issuerId,
    issuedAt,
    expiresAt,
    payload,
    signatureBase64,
  };
}

export function actorProofClaim(proof: ActorProof): SignedClaim {
  return claim(
    "actor-proof",
    `${proof.runId}:${proof.eventId}:actor:${proof.role}`,
    proof.identity,
    proof.issuedAt,
    proof.expiresAt,
    {
      role: proof.role,
      identity: proof.identity,
      runId: proof.runId,
      eventId: proof.eventId,
      fencingEpoch: proof.fencingEpoch,
      sourceSha: proof.sourceSha,
      policySha256: proof.policySha256,
    },
    proof.signature,
  );
}

export function guardProofClaim(proof: GuardProof): SignedClaim {
  return claim(
    "guard-proof",
    `${proof.runId}:${proof.eventId}:guard:${proof.guard}`,
    proof.issuer,
    proof.issuedAt,
    proof.expiresAt,
    {
      guard: proof.guard,
      runId: proof.runId,
      eventId: proof.eventId,
      fencingEpoch: proof.fencingEpoch,
      sourceSha: proof.sourceSha,
      policySha256: proof.policySha256,
      evidenceSha256: proof.evidenceSha256,
    },
    proof.signature,
  );
}

export function releasePermitClaim(permit: ReleasePermit): SignedClaim {
  return claim(
    "release-permit",
    permit.permitId,
    permit.issuer,
    permit.issuedAt,
    permit.expiresAt,
    {
      permitId: permit.permitId,
      nonce: permit.nonce,
      phase: permit.phase,
      runId: permit.runId,
      fencingEpoch: permit.fencingEpoch,
      sourceSha: permit.sourceSha,
      policySha256: permit.policySha256,
      manifestSha256: permit.manifestSha256,
    },
    permit.signature,
  );
}

export function capabilityAttestationClaim(attestation: CapabilityAttestation): SignedClaim {
  return claim(
    "capability-attestation",
    attestation.attestationId,
    attestation.issuer,
    attestation.issuedAt,
    attestation.expiresAt,
    {
      attestationId: attestation.attestationId,
      capability: attestation.capability,
      repositoryId: attestation.repositoryId,
      policySha256: attestation.policySha256,
      evidenceSha256: attestation.evidenceSha256,
      workerIsolation: attestation.workerIsolation,
      modelEvaluation: attestation.modelEvaluation,
    },
    attestation.signature,
  );
}

export function authorizationGrantClaim(grant: RuntimeAuthorizationGrant): SignedClaim {
  return claim(
    "authorization-grant",
    grant.grantId,
    grant.issuer,
    grant.issuedAt,
    grant.expiresAt,
    {
      grantId: grant.grantId,
      repositoryId: grant.repositoryId,
      policySha256: grant.policySha256,
      modes: grant.modes,
      billing: grant.billing,
    },
    grant.signature,
  );
}

export function dependencyReceiptClaim(receipt: DependencyReceipt): SignedClaim {
  return claim(
    "dependency-receipt",
    receipt.receiptId,
    receipt.issuer,
    receipt.issuedAt,
    receipt.expiresAt,
    {
      receiptId: receipt.receiptId,
      sliceId: receipt.sliceId,
      status: receipt.status,
      receiptSha256: receipt.receiptSha256,
      policySha256: receipt.policySha256,
      compatibleWithSourceSha: receipt.compatibleWithSourceSha,
    },
    receipt.signature,
  );
}

export function impactAssessmentClaim(assessment: ImpactAssessment): SignedClaim {
  return claim(
    "impact-assessment",
    assessment.assessmentId,
    assessment.issuer,
    assessment.issuedAt,
    assessment.expiresAt,
    {
      assessmentId: assessment.assessmentId,
      sliceId: assessment.sliceId,
      executionDomain: assessment.executionDomain,
      sourceSha: assessment.sourceSha,
      policySha256: assessment.policySha256,
      impactMapSha256: assessment.impactMapSha256,
      authorizedRoots: assessment.authorizedRoots,
      plannedPaths: assessment.plannedPaths,
      gateIds: assessment.gateIds,
      modelEvaluationIds: assessment.modelEvaluationIds,
    },
    assessment.signature,
  );
}

export function taskSpecLockClaim(proof: TaskSpecLockProof): SignedClaim {
  return claim(
    "taskspec-lock",
    proof.lockId,
    proof.issuer,
    proof.issuedAt,
    proof.expiresAt,
    {
      lockId: proof.lockId,
      taskSpecSha256: proof.taskSpecSha256,
      runId: proof.runId,
      sliceId: proof.sliceId,
      sourceSha: proof.sourceSha,
      policySha256: proof.policySha256,
    },
    proof.signature,
  );
}

export function workerIsolationClaim(attestation: WorkerIsolationAttestation): SignedClaim {
  return claim(
    "worker-isolation-attestation",
    attestation.attestationId,
    attestation.issuer,
    attestation.issuedAt,
    attestation.expiresAt,
    {
      attestationId: attestation.attestationId,
      taskSpecSha256: attestation.taskSpecSha256,
      policySha256: attestation.policySha256,
      runtimeImageSha256: attestation.runtimeImageSha256,
      engine: attestation.engine,
      networkMode: attestation.networkMode,
      rootFilesystemReadOnly: attestation.rootFilesystemReadOnly,
      sourceMountReadOnly: attestation.sourceMountReadOnly,
      writesThroughGateway: attestation.writesThroughGateway,
      nonRootUser: attestation.nonRootUser,
      noNewPrivileges: attestation.noNewPrivileges,
      droppedCapabilities: attestation.droppedCapabilities,
      dockerSocketMounted: attestation.dockerSocketMounted,
      hostHomeMounted: attestation.hostHomeMounted,
      credentialEnvironmentEmpty: attestation.credentialEnvironmentEmpty,
    },
    attestation.signature,
  );
}

export function credentialBrokerClaim(attestation: CredentialBrokerAttestation): SignedClaim {
  return claim(
    "credential-broker-attestation",
    attestation.attestationId,
    attestation.issuer,
    attestation.issuedAt,
    attestation.expiresAt,
    {
      attestationId: attestation.attestationId,
      taskSpecSha256: attestation.taskSpecSha256,
      policySha256: attestation.policySha256,
      providerId: attestation.providerId,
      providerHosts: attestation.providerHosts,
      noWorkspaceMount: attestation.noWorkspaceMount,
      tokenStorage: attestation.tokenStorage,
      ambientLoginDisabled: attestation.ambientLoginDisabled,
      toolProcessReceivesCredentials: attestation.toolProcessReceivesCredentials,
    },
    attestation.signature,
  );
}

export function providerUsageReceiptClaim(receipt: ProviderUsageReceipt): SignedClaim {
  const { signature: _signature, ...payload } = receipt;
  return claim(
    "provider-usage-receipt",
    receipt.receiptId,
    receipt.issuer,
    receipt.issuedAt,
    receipt.expiresAt,
    payload,
    receipt.signature,
  );
}

export function modelEvaluationObservationClaim(observation: LiveModelRunObservation): SignedClaim {
  const { signature: _signature, ...payload } = observation;
  return claim(
    "model-evaluation-observation",
    `${observation.evaluationId}:${observation.runId}:${observation.caseId}:${observation.repetition}`,
    observation.producerIdentity,
    observation.issuedAt,
    observation.expiresAt,
    payload,
    observation.signature,
  );
}

export function evidencePacketClaim(packet: CandidateEvidencePacket): SignedClaim {
  return claim(
    "evidence-packet",
    packet.packetId,
    packet.issuer,
    packet.issuedAt,
    packet.expiresAt,
    {
      schemaVersion: packet.schemaVersion,
      status: packet.status,
      releaseEligible: packet.releaseEligible,
      packetId: packet.packetId,
      runId: packet.runId,
      sliceId: packet.sliceId,
      taskSpecSha256: packet.taskSpecSha256,
      source: packet.source,
      bindings: packet.bindings,
      subjects: packet.subjects,
      checks: packet.checks,
      negativeControls: packet.negativeControls,
    },
    packet.signature,
  );
}

export function evidenceCheckClaim(check: EvidenceCheck, packet: CandidateEvidencePacket): SignedClaim {
  const { signature: _signature, ...signedCheck } = check;
  return claim(
    "evidence-check",
    `${packet.packetId}:${check.checkId}`,
    check.producerIdentity,
    check.issuedAt,
    check.expiresAt,
    {
      packetId: packet.packetId,
      runId: packet.runId,
      sliceId: packet.sliceId,
      taskSpecSha256: packet.taskSpecSha256,
      sourceSha: packet.source.sourceSha,
      policySha256: packet.bindings.policySha256,
      ...signedCheck,
    },
    check.signature,
  );
}

export class TrustBackedAuthorities implements HarnessAuthorities, TaskSpecAuthorities, ReadinessAuthorities, WorkerAuthorities, EvidenceAuthorities, ExecutionCoordinatorAuthorities, LiveModelEvaluationAuthorities {
  constructor(
    private readonly verifier: TrustVerifier,
    private readonly clock: { now(): number },
    readonly limits: TrustLimits,
  ) {}

  now(): number {
    return this.clock.now();
  }

  verifyProviderUsage(receipt: ProviderUsageReceipt): boolean {
    return this.verifier.verify(providerUsageReceiptClaim(receipt)).valid;
  }

  verifyObservation(observation: LiveModelRunObservation): boolean {
    return this.verifier.verify(modelEvaluationObservationClaim(observation)).valid;
  }

  verifyActor(proof: ActorProof): boolean {
    return this.verifier.verify(actorProofClaim(proof)).valid;
  }

  verifyGuard(proof: GuardProof): boolean {
    return this.verifier.verify(guardProofClaim(proof)).valid;
  }

  verifyPermit(permit: ReleasePermit): boolean {
    return this.verifier.verify(releasePermitClaim(permit)).valid;
  }

  verifyAuthorization(grant: RuntimeAuthorizationGrant): boolean {
    return this.verifier.verify(authorizationGrantClaim(grant)).valid;
  }

  verifyCapability(attestation: CapabilityAttestation): boolean {
    return this.verifier.verify(capabilityAttestationClaim(attestation)).valid;
  }

  verifyDependencyReceipt(receipt: DependencyReceipt): boolean {
    return this.verifier.verify(dependencyReceiptClaim(receipt)).valid;
  }

  verifyImpactAssessment(assessment: ImpactAssessment): boolean {
    return this.verifier.verify(impactAssessmentClaim(assessment)).valid;
  }

  verifyTaskSpecLock(proof: TaskSpecLockProof): boolean {
    return this.verifier.verify(taskSpecLockClaim(proof)).valid;
  }

  verifyWorkerIsolation(attestation: WorkerIsolationAttestation): boolean {
    return this.verifier.verify(workerIsolationClaim(attestation)).valid;
  }

  verifyCredentialBroker(attestation: CredentialBrokerAttestation): boolean {
    return this.verifier.verify(credentialBrokerClaim(attestation)).valid;
  }

  verifyEvidencePacket(packet: CandidateEvidencePacket): boolean {
    return this.verifier.verify(evidencePacketClaim(packet)).valid;
  }

  verifyEvidenceCheck(check: EvidenceCheck, packet: CandidateEvidencePacket): boolean {
    return this.verifier.verify(evidenceCheckClaim(check, packet)).valid;
  }
}