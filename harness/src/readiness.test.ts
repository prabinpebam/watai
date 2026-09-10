// @vitest-environment node
import { describe, expect, it } from "vitest";

import policyJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/policy.json";
import {
  assessReadiness,
  type CapabilityAttestation,
  type HarnessCapability,
  type HarnessPolicySummary,
  type ReadinessAuthorities,
  type RuntimeAuthorizationGrant,
} from "./readiness";

const policySha256 = "policy-sha";
const now = Date.parse("2026-09-10T11:00:00.000Z");
const authorities: ReadinessAuthorities = {
  now: () => now,
  verifyAuthorization: (grant) => grant.signature === `trusted:${grant.grantId}`,
  verifyCapability: (attestation) =>
    attestation.signature === `trusted:${attestation.attestationId}`,
};

const attestation = (capability: HarnessCapability): CapabilityAttestation => ({
  attestationId: `attestation:${capability}`,
  capability,
  repositoryId: "prabinpebam/watai",
  policySha256,
  evidenceSha256: "a".repeat(64),
  ...(capability === "agent-model-evaluation" ? {
    modelEvaluation: {
      evaluationId: "implementation-agent-smoke",
      manifestSha256: "b".repeat(64),
      outcome: "PASSED" as const,
      expectedRuns: 9,
      attemptedRuns: 9,
      providerId: "github-copilot",
      requestedModel: "gpt-5.4",
      observedModelVersions: ["gpt-5.4-2026-03-05"],
      reportSha256: "c".repeat(64),
      usage: { usd: 0, inputTokens: 9000, outputTokens: 900, requests: 9 },
    },
  } : {}),
  issuer: "trusted-capability-verifier",
  issuedAt: "2026-09-10T10:55:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: `trusted:attestation:${capability}`,
});

const authorizationGrant = (): RuntimeAuthorizationGrant => ({
  grantId: "grant-001",
  repositoryId: "prabinpebam/watai",
  policySha256,
  modes: ["implementation"],
  billing: {
    kind: "subscription",
    maxUsd: 0,
    maxInputTokens: 1_200_000,
    maxOutputTokens: 120_000,
    maxRequests: 100,
    maxAiCredits: 100,
  },
  issuer: "trusted-authorization-root",
  issuedAt: "2026-09-10T10:55:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: "trusted:grant-001",
});

const context = { repositoryId: "prabinpebam/watai" };

const implementationCapabilities: HarnessCapability[] = [
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
  "agent-model-evaluation",
  "provider-usage",
  "tool-gateway",
  "watchdog",
  "worker-isolation",
];

describe("harness readiness", () => {
  it("allows only offline rehearsal under the checked-in policy", () => {
    const policy = policyJson as HarnessPolicySummary;

    const rehearsal = assessReadiness(policy, policySha256, "rehearsal", [], authorities, context);
    const implementation = assessReadiness(
      policy,
      policySha256,
      "implementation",
      [],
      authorities,
      context,
    );

    expect(rehearsal.ready).toBe(true);
    expect(rehearsal.warnings.map((finding) => finding.code)).toContain("REHEARSAL_ONLY");
    expect(implementation.ready).toBe(false);
    expect(implementation.blockers.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "AUTHORIZATION_NOT_GRANTED",
        "CAPABILITY_MISSING:durable-ledger",
        "CAPABILITY_MISSING:worker-isolation",
      ]),
    );
  });

  it("permits implementation only with authorization and every trusted capability", () => {
    const policy: HarnessPolicySummary = {
      schemaVersion: "1.0",
      status: "SPECIFIED",
      authorizationGranted: true,
      effectiveSpendUsd: 20,
    };
    const result = assessReadiness(
      policy,
      policySha256,
      "implementation",
      implementationCapabilities.map(attestation),
      authorities,
      { ...context, authorizationGrant: authorizationGrant() },
    );

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings.map((finding) => finding.code)).toContain("NO_RELEASE_AUTHORITY");
  });

  it("does not confuse implementation readiness with release readiness", () => {
    const policy: HarnessPolicySummary = {
      schemaVersion: "1.0",
      status: "SPECIFIED",
      authorizationGranted: true,
      effectiveSpendUsd: 20,
    };
    const result = assessReadiness(
      policy,
      policySha256,
      "release",
      implementationCapabilities.map(attestation),
      authorities,
      {
        ...context,
        authorizationGrant: { ...authorizationGrant(), modes: ["release"] },
      },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "CAPABILITY_MISSING:immutable-evidence",
        "CAPABILITY_MISSING:release-broker",
        "CAPABILITY_MISSING:rollback-target",
        "CAPABILITY_MISSING:staged-environment",
      ]),
    );
  });

  it("rejects expired and untrusted capability attestations", () => {
    const policy: HarnessPolicySummary = {
      schemaVersion: "1.0",
      status: "SPECIFIED",
      authorizationGranted: true,
      effectiveSpendUsd: 20,
    };
    const attestations = implementationCapabilities.map(attestation);
    attestations[0] = {
      ...attestations[0],
      expiresAt: "2026-09-10T10:59:00.000Z",
    };
    attestations[1] = {
      ...attestations[1],
      signature: "self-asserted",
    };

    const result = assessReadiness(
      policy,
      policySha256,
      "implementation",
      attestations,
      authorities,
      { ...context, authorizationGrant: authorizationGrant() },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "CAPABILITY_MISSING:agent-provider",
        "CAPABILITY_MISSING:authorization-root",
      ]),
    );
  });

  it("rejects a runtime grant for another repository", () => {
    const policy = policyJson as HarnessPolicySummary;
    const result = assessReadiness(
      policy,
      policySha256,
      "implementation",
      implementationCapabilities.map(attestation),
      authorities,
      {
        ...context,
        authorizationGrant: { ...authorizationGrant(), repositoryId: "other/repository" },
      },
    );

    expect(result.ready).toBe(false);
    expect(result.blockers.map((finding) => finding.code)).toContain("AUTHORIZATION_NOT_GRANTED");
  });

  it("rejects a generic agent-model capability without passed frozen results", () => {
    const policy: HarnessPolicySummary = {
      schemaVersion: "1.0", status: "SPECIFIED", authorizationGranted: true, effectiveSpendUsd: 20,
    };
    const attestations = implementationCapabilities.map(attestation);
    const index = attestations.findIndex((item) => item.capability === "agent-model-evaluation");
    attestations[index] = { ...attestations[index], modelEvaluation: undefined };
    const result = assessReadiness(policy, policySha256, "implementation", attestations, authorities, {
      ...context, authorizationGrant: authorizationGrant(),
    });
    expect(result.blockers.map((blocker) => blocker.code)).toContain("CAPABILITY_MISSING:agent-model-evaluation");
  });

  it("allows an authorized evaluator to produce the agent-model result without circular self-dependency", () => {
    const policy: HarnessPolicySummary = {
      schemaVersion: "1.0", status: "SPECIFIED", authorizationGranted: true, effectiveSpendUsd: 20,
    };
    const evaluationOnly = [
      ...implementationCapabilities.filter((capability) => capability !== "agent-model-evaluation"),
      "browser-runner",
      "immutable-evidence",
      "live-model-evaluator",
      "evaluator-pack",
      "trusted-build",
    ] as HarnessCapability[];
    const result = assessReadiness(policy, policySha256, "evaluation", evaluationOnly.map(attestation), authorities, {
      ...context,
      authorizationGrant: { ...authorizationGrant(), modes: ["evaluation"] },
    });
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain("CAPABILITY_MISSING:agent-model-evaluation");
    expect(result.ready).toBe(true);
  });
});