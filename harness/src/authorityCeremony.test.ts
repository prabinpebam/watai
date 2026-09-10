// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildAuthorityCeremonyRequest, implementationAgentBootstrapCapabilities } from "./authorityCeremony";

const digest = (value: string) => value.repeat(64);

describe("authority ceremony request", () => {
  it("requests only evaluation bootstrap authority and scopes isolation to the smoke image", () => {
    const request = buildAuthorityCeremonyRequest({
      attemptId: "attempt-001",
      repositoryId: "prabinpebam/watai",
      evidence: {
        sourceSha: "1".repeat(40),
        rootInputs: {
          backlogSha256: digest("1"), policySha256: digest("2"), workflowSha256: digest("3"),
          planSchemaSha256: digest("4"), controllerSha256: digest("5"), evaluatorPackSha256: digest("6"),
          testInventorySha256: digest("7"), fixtureManifestSha256: digest("8"), toolchainSha256: digest("9"),
          dependencyLockSha256: digest("a"), impactMapSha256: digest("b"), negativeControlIds: ["NC-test"],
        },
        smokeWorkerImageSha256: digest("c"),
        smokeWorkerProbeSha256: digest("d"),
        validationOutputSha256: digest("e"),
        npmRegistry: "https://packagefeedproxy.microsoft.io/npm/",
        gitHubCliAuthenticated: true,
        dockerServerVersion: "29.6.2",
      },
      evaluationBudget: { usd: 0, inputTokens: 45_000, outputTokens: 9_000, requests: 9 },
      maxAiCredits: 9,
      claimLifetimeSeconds: 3_600,
    });
    const grant = request.unsignedClaimRequests.find((claim) => claim.kind === "authorization-grant");
    expect(request.attemptId).toBe("attempt-001");
    expect(grant?.artifactId).toContain("attempt-001");
    expect(grant?.payload).toMatchObject({ modes: ["evaluation"], billing: { kind: "subscription", maxUsd: 0 } });
    expect(request.unsignedClaimRequests.filter((claim) => claim.kind === "capability-attestation")).toHaveLength(
      implementationAgentBootstrapCapabilities.length,
    );
    const isolation = request.unsignedClaimRequests.find((claim) =>
      claim.artifactId.endsWith("worker-isolation"));
    expect(isolation?.payload).toMatchObject({
      workerIsolation: { scope: "implementation-agent-smoke", runtimeImageSha256: digest("c") },
    });
    expect(request.requiredIssuers.find((issuer) => issuer.purpose === "runtime-evidence")?.allowedKinds)
      .toEqual(["model-evaluation-observation", "provider-usage-receipt", "worker-isolation-attestation"]);
  });
});