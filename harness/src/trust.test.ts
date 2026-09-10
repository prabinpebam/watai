// @vitest-environment node
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import policyJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/policy.json";
import {
  assessPolicyFloor,
  claimSigningBytes,
  TrustVerifier,
  trustRootSha256,
  type PolicyFloor,
  type SignedClaim,
  type TrustRootManifest,
} from "./trust";

const now = Date.parse("2026-09-10T11:00:00.000Z");
const keyPair = generateKeyPairSync("ed25519");
const publicKeySpkiPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

const root = (): TrustRootManifest => ({
  schemaVersion: "1.0",
  status: "ACTIVE",
  rootId: "root-001",
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
    issuerId: "independent-verifier",
    publicKeySpkiPem,
    allowedKinds: ["taskspec-lock", "policy-candidate"],
    allowedRoles: [],
  }],
  revokedArtifactIds: [],
});

function signedClaim(manifest: TrustRootManifest): SignedClaim<{ taskSpecSha256: string }> {
  const unsigned: SignedClaim<{ taskSpecSha256: string }> = {
    schemaVersion: "1.0",
    kind: "taskspec-lock",
    artifactId: "lock-001",
    issuerId: "independent-verifier",
    issuedAt: "2026-09-10T10:59:00.000Z",
    expiresAt: "2026-09-10T11:05:00.000Z",
    payload: { taskSpecSha256: "e".repeat(64) },
    signatureBase64: "",
  };
  return {
    ...unsigned,
    signatureBase64: sign(null, claimSigningBytes(manifest, unsigned), keyPair.privateKey).toString("base64"),
  };
}

describe("public trust verifier", () => {
  it("verifies an allowed, current, root-bound Ed25519 claim", () => {
    const manifest = root();
    const verifier = new TrustVerifier(manifest, { now: () => now }, {
      expectedRootSha256: trustRootSha256(manifest),
      maxClockSkewMs: 5_000,
      maxArtifactLifetimeMs: 15 * 60_000,
    });

    expect(verifier.verify(signedClaim(manifest))).toMatchObject({ valid: true, code: "VERIFIED" });
  });

  it.each([
    ["changed payload", (claim: SignedClaim) => ({ ...claim, payload: { taskSpecSha256: "f".repeat(64) } }), "SIGNATURE_INVALID"],
    ["wrong kind", (claim: SignedClaim) => ({ ...claim, kind: "release-permit" as const }), "ISSUER_FORBIDDEN"],
    ["expired", (claim: SignedClaim) => ({ ...claim, expiresAt: "2026-09-10T10:59:30.000Z" }), "ARTIFACT_EXPIRED"],
  ])("rejects %s", (_label, mutate, code) => {
    const manifest = root();
    const verifier = new TrustVerifier(manifest, { now: () => now }, {
      expectedRootSha256: trustRootSha256(manifest),
      maxClockSkewMs: 5_000,
      maxArtifactLifetimeMs: 15 * 60_000,
    });
    expect(verifier.verify(mutate(signedClaim(manifest)))).toMatchObject({ valid: false, code });
  });

  it("rejects a valid signature under an unpinned root digest", () => {
    const manifest = root();
    const verifier = new TrustVerifier(manifest, { now: () => now }, {
      expectedRootSha256: "0".repeat(64),
      maxClockSkewMs: 5_000,
      maxArtifactLifetimeMs: 15 * 60_000,
    });
    expect(verifier.verify(signedClaim(manifest))).toMatchObject({
      valid: false,
      code: "ROOT_DIGEST_MISMATCH",
    });
  });
});

describe("old-root policy floor", () => {
  const current = policyJson as unknown as PolicyFloor;

  it("accepts an unchanged policy", () => {
    expect(assessPolicyFloor(current, structuredClone(current))).toEqual({
      compatible: true,
      blockers: [],
    });
  });

  it.each([
    ["removed gate", (candidate: PolicyFloor) => candidate.mandatoryGates.pop(), "MANDATORY_GATE_REMOVED"],
    ["self authorization", (candidate: PolicyFloor) => { candidate.authorizationGranted = true; }, "AUTHORITY_INCREASED"],
    ["more spend", (candidate: PolicyFloor) => { candidate.effectiveSpendUsd = 1; }, "SPEND_INCREASED"],
    ["role escalation", (candidate: PolicyFloor) => { candidate.roles[0].canRelease = true; }, "ROLE_AUTHORITY_INCREASED"],
    ["wider retries", (candidate: PolicyFloor) => { candidate.limits.builderAttempts = 4; }, "LIMIT_WIDENED"],
  ])("rejects %s", (_label, mutate, code) => {
    const candidate = structuredClone(current);
    mutate(candidate);
    expect(assessPolicyFloor(current, candidate).blockers.map((blocker) => blocker.code)).toContain(code);
  });
});