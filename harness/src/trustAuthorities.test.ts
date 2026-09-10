// @vitest-environment node
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { ActorProof } from "./controller";
import type { RuntimeAuthorizationGrant } from "./readiness";
import {
  actorProofClaim,
  authorizationGrantClaim,
  modelEvaluationObservationClaim,
  providerUsageReceiptClaim,
  TrustBackedAuthorities,
} from "./trustAuthorities";
import type { ProviderUsageReceipt } from "./executionCoordinator";
import type { LiveModelRunObservation } from "./modelEvaluation";
import {
  claimSigningBytes,
  TrustVerifier,
  trustRootSha256,
  type SignedClaim,
  type TrustRootManifest,
  type TrustedArtifactKind,
} from "./trust";

const now = Date.parse("2026-09-10T11:00:00.000Z");
const keys = generateKeyPairSync("ed25519");
const issuer = "independent-authority";
const kinds: TrustedArtifactKind[] = [
  "actor-proof",
  "authorization-grant",
  "capability-attestation",
  "credential-broker-attestation",
  "dependency-receipt",
  "deployment-observation",
  "evidence-check",
  "evidence-packet",
  "guard-proof",
  "impact-assessment",
  "policy-candidate",
  "provider-usage-receipt",
  "release-permit",
  "taskspec-lock",
  "value-assessment",
  "model-evaluation-observation",
  "worker-isolation-attestation",
];
const root: TrustRootManifest = {
  schemaVersion: "1.0",
  status: "ACTIVE",
  rootId: "root-authorities",
  repositoryId: "prabinpebam/watai",
  epoch: 1,
  validFrom: "2026-09-10T10:00:00.000Z",
  validUntil: "2026-09-11T10:00:00.000Z",
  backlogSha256: "0".repeat(64),
  policySha256: "a".repeat(64),
  workflowSha256: "b".repeat(64),
  planSchemaSha256: "1".repeat(64),
  controllerSha256: "c".repeat(64),
  evaluatorPackSha256: "d".repeat(64),
  testInventorySha256: "2".repeat(64),
  fixtureManifestSha256: "3".repeat(64),
  toolchainSha256: "4".repeat(64),
  dependencyLockSha256: "5".repeat(64),
  impactMapSha256: "6".repeat(64),
  negativeControlIds: ["NC-forged-proof"],
  issuers: [{
    issuerId: issuer,
    publicKeySpkiPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    allowedKinds: kinds,
    allowedRoles: ["controller", "evaluator", "release-verifier"],
  }],
  revokedArtifactIds: [],
};
const verifier = new TrustVerifier(root, { now: () => now }, {
  expectedRootSha256: trustRootSha256(root),
  maxClockSkewMs: 5_000,
  maxArtifactLifetimeMs: 15 * 60_000,
});
const authorities = new TrustBackedAuthorities(verifier, { now: () => now }, {
  maxClockSkewMs: 5_000,
  maxGuardProofLifetimeMs: 15 * 60_000,
  maxPermitLifetimeMs: 15 * 60_000,
  maxEffectLifetimeMs: 20 * 60_000,
});

function signature(claim: SignedClaim): string {
  return sign(null, claimSigningBytes(root, claim), keys.privateKey).toString("base64");
}

function actor(): ActorProof {
  const value: ActorProof = {
    role: "controller",
    identity: issuer,
    runId: "run-001",
    eventId: "event-001",
    fencingEpoch: 1,
    sourceSha: "source-001",
    policySha256: root.policySha256,
    issuedAt: "2026-09-10T10:59:00.000Z",
    expiresAt: "2026-09-10T11:05:00.000Z",
    signature: "",
  };
  value.signature = signature(actorProofClaim(value));
  return value;
}

function grant(): RuntimeAuthorizationGrant {
  const value: RuntimeAuthorizationGrant = {
    grantId: "grant-001",
    repositoryId: root.repositoryId,
    policySha256: root.policySha256,
    modes: ["implementation"],
    billing: {
      kind: "subscription",
      maxUsd: 0,
      maxInputTokens: 100_000,
      maxOutputTokens: 10_000,
      maxRequests: 20,
      maxAiCredits: 20,
    },
    issuer,
    issuedAt: "2026-09-10T10:59:00.000Z",
    expiresAt: "2026-09-10T11:05:00.000Z",
    signature: "",
  };
  value.signature = signature(authorizationGrantClaim(value));
  return value;
}

describe("trust-backed harness authorities", () => {
  it("verifies signed usage receipts and live-model observations", () => {
    const usage: ProviderUsageReceipt = {
      receiptId: "usage-1", runId: "run-1", effectId: "effect-1", reservationId: "reservation-1",
      providerId: "github-copilot", model: "gpt-5.4", resolvedModelVersion: "gpt-5.4-test",
      premiumRequestCost: 1, aiCredits: 1,
      usage: { usd: 0, inputTokens: 100, outputTokens: 20, requests: 1 },
      outputSha256: "a".repeat(64), completedAt: "2026-09-10T11:00:00.000Z",
      issuer, issuedAt: "2026-09-10T10:59:00.000Z", expiresAt: "2026-09-10T11:05:00.000Z", signature: "",
    };
    usage.signature = signature(providerUsageReceiptClaim(usage));
    const observation: LiveModelRunObservation = {
      evaluationId: "implementation-agent-smoke", runId: "model-run", caseId: "bounded-read", repetition: 1,
      providerId: "github-copilot", requestedModel: "gpt-5.4", resolvedModelVersion: "gpt-5.4-test",
      status: "completed", semanticPass: true, latencyMs: 100,
      usage: { usd: 0, inputTokens: 100, outputTokens: 20, requests: 1 },
      usageReceiptSha256: "b".repeat(64), responseSha256: "c".repeat(64),
      caseDefinitionSha256: "d".repeat(64), graderSha256: "e".repeat(64), errorCode: null,
      gradedArtifactSha256: "f".repeat(64), gradeOutputSha256: "1".repeat(64),
      completedAt: "2026-09-10T11:00:00.000Z", producerIdentity: issuer,
      issuedAt: "2026-09-10T10:59:00.000Z", expiresAt: "2026-09-10T11:05:00.000Z", signature: "",
    };
    observation.signature = signature(modelEvaluationObservationClaim(observation));
    expect(authorities.verifyProviderUsage(usage)).toBe(true);
    expect(authorities.verifyObservation(observation)).toBe(true);
  });

  it("verifies controller and runtime authorization through the pinned root", () => {
    expect(authorities.verifyActor(actor())).toBe(true);
    expect(authorities.verifyAuthorization(grant())).toBe(true);
  });

  it("rejects semantic mutation after signing", () => {
    expect(authorities.verifyActor({ ...actor(), sourceSha: "changed" })).toBe(false);
    expect(authorities.verifyAuthorization({
      ...grant(),
      billing: { ...grant().billing, maxRequests: 200 },
    })).toBe(false);
  });

  it("rejects a claim bound to a different policy", () => {
    const value = actor();
    value.policySha256 = "f".repeat(64);
    value.signature = signature(actorProofClaim(value));
    expect(authorities.verifyActor(value)).toBe(false);
  });
});